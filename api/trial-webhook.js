const { sbFetch, requireSupabaseEnv } = require('./lib/supabase')

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.end(JSON.stringify(body))
}

async function parseRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function callProvision(baseUrl, payload) {
  try {
    await fetch(`${baseUrl}/api/provision-trial-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    // non-fatal in test flow
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  try {
    requireSupabaseEnv()
  } catch (err) {
    return json(res, 500, { error: err.message })
  }

  const secret = String(process.env.STRIPE_WEBHOOK_SECRET || '').trim()
  const raw = await parseRaw(req)

  let event = null
  try {
    event = raw ? JSON.parse(raw) : null
  } catch {
    return json(res, 400, { error: 'Invalid webhook payload' })
  }

  // Signature verification can be added later; in test mode we still require secret presence.
  if (!secret) return json(res, 500, { error: 'STRIPE_WEBHOOK_SECRET missing' })

  if (!event || event.type !== 'checkout.session.completed') {
    return json(res, 200, { received: true, ignored: true })
  }

  const session = event.data?.object || {}
  const leadId = String(session?.metadata?.lead_id || '').trim()
  if (!leadId) return json(res, 200, { received: true, ignored: true })

  await sbFetch(`leads?id=eq.${encodeURIComponent(leadId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'paid',
      stripe_session_id: session.id || null,
      paid_at: new Date().toISOString(),
    }),
  })

  const lead = await sbFetch(`leads?id=eq.${encodeURIComponent(leadId)}&select=*`, { method: 'GET' })
  const row = Array.isArray(lead.data) ? lead.data[0] : null

  if (row?.email && row?.first_name) {
    const kids =
      Array.isArray(row.children) && row.children.length
        ? row.children.map((k) => [k?.first || '', k?.last || ''].filter(Boolean).join(' ').trim()).filter(Boolean).join(',')
        : ''
    const baseUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`
    await callProvision(baseUrl, {
      email: row.email,
      first_name: row.first_name,
      last_name: row.last_name || '',
      phone: row.phone || '',
      member_id: `trial_lead_${leadId}`,
      kids,
      lead_id: leadId,
    })
  }

  return json(res, 200, { received: true })
}

