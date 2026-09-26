const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, sbFetch, requireSupabaseEnv } = require('./lib/supabase')
const { sendTrialWelcomeEmail } = require('./lib/send-trial-welcome-email')

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
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

function generateTempPassword() {
  return `Impact${Math.floor(100 + Math.random() * 900)}Go!`
}

async function createAuthUser(email, password, metadata) {
  const url = `${SUPABASE_URL}/auth/v1/admin/users`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata || {},
    }),
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  return { ok: res.ok, status: res.status, data, text }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return json(res, 204, {})
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

  const { email, first_name, last_name, phone, member_id, kids, lead_id } = body || {}
  if (!email || !first_name) return json(res, 400, { error: 'email and first_name are required' })

  const tempPassword = generateTempPassword()
  let authUserId = null

  const created = await createAuthUser(String(email).trim(), tempPassword, {
    first_name: first_name || '',
    last_name: last_name || '',
    member_id: member_id || null,
  })

  if (created.ok && created.data?.id) {
    authUserId = created.data.id
  }

  if (authUserId) {
    await sbFetch(`members?id=eq.${encodeURIComponent(authUserId)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        external_id: member_id || null,
        first_name: first_name || null,
        last_name: last_name || null,
        app_provisioned: true,
        temp_password_sent: true,
      }),
      headers: { Prefer: 'return=minimal' },
    })
  }

  const emailResult = await sendTrialWelcomeEmail({
    to: String(email),
    firstName: String(first_name),
    kids: kids || '',
    phone: phone || '',
    leadId: lead_id || member_id || '',
    tempPassword,
  })

  return json(res, 200, {
    success: true,
    auth_user_created: !!authUserId,
    emailSent: emailResult.ok === true,
    emailError: emailResult.ok ? null : emailResult.error || null,
  })
}
