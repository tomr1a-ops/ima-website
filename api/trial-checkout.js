const { sbFetch, requireSupabaseEnv } = require('./lib/supabase')

const IMA_STUDIO_ID = 'ec356e58-a649-4fd3-a098-ebe91f396d84'
const IMA_STUDIO_NAME = 'Impact Martial Athletics'
const IMA_TRIAL_PRICE_CENTS = 2700

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body)
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim()
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function normalizePhone(raw) {
  if (!raw) return raw
  const stripped = String(raw).replace(/\D/g, '')
  if (stripped.length === 10) return `+1${stripped}`
  if (stripped.length === 11 && stripped[0] === '1') return `+${stripped}`
  if (stripped.length > 7) return `+${stripped}`
  return raw
}

function formEncoded(obj) {
  const params = new URLSearchParams()
  Object.entries(obj).forEach(([k, v]) => {
    if (v === undefined || v === null) return
    params.append(k, String(v))
  })
  return params
}

async function createStripeCheckoutSession(payload) {
  const secret = String(process.env.STRIPE_SECRET_KEY || '').trim()
  if (!secret) return { ok: false, error: 'STRIPE_SECRET_KEY missing' }
  if (!secret.startsWith('sk_test_')) return { ok: false, error: 'STRIPE_SECRET_KEY is not test mode' }

  const body = formEncoded(payload)
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) return { ok: false, error: data?.error?.message || text || `Stripe HTTP ${res.status}` }
  return { ok: true, data }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, {})
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  try {
    requireSupabaseEnv()
  } catch (err) {
    return json(res, 500, { error: err.message })
  }

  let body
  try {
    body = await parseBody(req)
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' })
  }

  const first_name = String(body.first_name || '').trim()
  const last_name = String(body.last_name || '').trim()
  const email = String(body.email || '').trim()
  const phone = normalizePhone(String(body.phone || '').trim())
  const children = Array.isArray(body.children) ? body.children : []
  const message = body.message ? String(body.message) : null
  const referral_source = body.referral_source ? String(body.referral_source) : null
  const num_children = Math.max(1, Math.min(4, Number.parseInt(String(body.num_children || children.length || 1), 10) || 1))

  if (!first_name || !last_name || !email || !phone) {
    return json(res, 400, { error: 'Missing required fields' })
  }

  const leadPayload = {
    studio_id: IMA_STUDIO_ID,
    first_name,
    last_name,
    email,
    phone,
    num_children,
    children: children.length ? children : null,
    message,
    source: 'trial_page',
    referral_source,
    status: 'new',
  }

  let leadRes = await sbFetch('leads', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(leadPayload),
  })

  if (!leadRes.ok && String(leadRes.text || '').includes('referral_source')) {
    const fallback = { ...leadPayload }
    delete fallback.referral_source
    leadRes = await sbFetch('leads', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(fallback),
    })
  }
  if (!leadRes.ok || !Array.isArray(leadRes.data) || !leadRes.data[0]?.id) {
    return json(res, 500, { error: `Could not capture lead (${leadRes.status})` })
  }
  const leadId = String(leadRes.data[0].id)

  const fullName = `${first_name} ${last_name}`.trim()
  const firstChild = children[0] || null
  const currentYear = new Date().getFullYear()
  const familyMembers = children.map((c) => {
    const cFirst = String(c?.first || c?.first_name || String(c?.name || '').split(' ')[0] || '')
    const cLast = String(c?.last || c?.last_name || String(c?.name || '').split(' ').slice(1).join(' ') || last_name || '')
    const cAge = c?.age != null ? Number.parseInt(String(c.age), 10) : null
    return {
      name: [cFirst, cLast].filter(Boolean).join(' '),
      first: cFirst,
      last: cLast,
      age_tier: 'child',
      relation: 'child',
      age: Number.isFinite(cAge) ? cAge : null,
      dob: Number.isFinite(cAge) ? `${currentYear - cAge}-01-01` : null,
      status: 'not_scheduled',
      _source: 'trial_page',
      membership: { plan: 'trial', planName: 'Trial Membership' },
      gender: c?.gender || null,
    }
  })

  const trialFields = {
    status: 'not_scheduled',
    source: 'trial_page',
    child_name: firstChild ? [firstChild.first || '', firstChild.last || ''].filter(Boolean).join(' ') : null,
    child_first: firstChild ? String(firstChild.first || '') : null,
    child_last: firstChild ? String(firstChild.last || '') : null,
    family_members: familyMembers,
    updated_date: `${new Date().toISOString().slice(0, 10)}T00:00:00+00:00`,
    external_id: `trial_lead_${leadId}`,
  }

  await sbFetch('prospects', {
    method: 'POST',
    headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
    body: JSON.stringify({
      studio_id: IMA_STUDIO_ID,
      name: fullName,
      phone,
      email,
      added_date: `${new Date().toISOString().slice(0, 10)}T00:00:00+00:00`,
      ...trialFields,
    }),
  })

  const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
  const kidsStr =
    children
      .map((kid) => [String(kid?.first || ''), String(kid?.last || '')].filter(Boolean).join(' ').trim())
      .filter(Boolean)
      .join(',') || ''

  const session = await createStripeCheckoutSession({
    mode: 'payment',
    'payment_method_types[0]': 'card',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': IMA_TRIAL_PRICE_CENTS,
    'line_items[0][price_data][product_data][name]': `${IMA_STUDIO_NAME} Trial Membership`,
    'line_items[0][price_data][product_data][description]': '2 Classes + Impact Shirt per child',
    'line_items[0][quantity]': num_children,
    customer_email: email,
    success_url: `${origin}/schedule?session_id={CHECKOUT_SESSION_ID}&lead_id=${encodeURIComponent(leadId)}&phone=${encodeURIComponent(phone)}&kids=${encodeURIComponent(kidsStr)}`,
    cancel_url: `${origin}/trial`,
    'metadata[studio_id]': IMA_STUDIO_ID,
    'metadata[studio_slug]': 'ima',
    'metadata[lead_id]': leadId,
    'metadata[first_name]': first_name,
    'metadata[last_name]': last_name,
    'metadata[num_children]': String(num_children),
  })

  if (!session.ok || !session.data?.url) return json(res, 500, { error: session.error || 'Stripe checkout failed' })

  return json(res, 200, { url: session.data.url, lead_id: leadId })
}
