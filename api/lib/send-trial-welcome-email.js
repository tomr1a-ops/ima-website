const STAFF_NOTIFY_EMAIL = 'tomr1a@gmail.com'

function uniqEmails(values) {
  const seen = new Set()
  const out = []
  for (const raw of values) {
    const v = String(raw || '').trim().toLowerCase()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

async function sendTrialWelcomeEmail({ to, firstName, kids, phone, leadId, tempPassword }) {
  const key = String(process.env.RESEND_API_KEY || '').trim()
  if (!key) return { ok: false, skipped: true, error: 'RESEND_API_KEY missing' }

  const scheduleUrl =
    `https://ima-os.com/schedule/ima?` +
    `phone=${encodeURIComponent(phone || '')}&` +
    `kids=${encodeURIComponent(kids || '')}&` +
    `lead_id=${encodeURIComponent(leadId || '')}`

  const memberAppUrl = process.env.MEMBER_APP_URL || 'https://member-app-three.vercel.app'
  const recipients = uniqEmails([to, STAFF_NOTIFY_EMAIL])

  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a">
    <h2>Welcome to Impact Martial Athletics</h2>
    <p>Hi ${firstName || 'there'}, your trial signup is confirmed.</p>
    <p>${kids ? `Kids: ${kids}` : ''}</p>
    <p><a href="${scheduleUrl}">Schedule your trial class</a></p>
    <p><a href="${memberAppUrl}">Open member app</a></p>
    <p>Temporary password: <strong>${tempPassword}</strong></p>
  </body></html>`

  const body = {
    from: process.env.RESEND_FROM_EMAIL || 'Impact Martial Athletics <info@imaimpact.com>',
    to: recipients,
    subject: 'Impact Trial Signup',
    html,
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: text || `HTTP ${res.status}` }
  }
  const json = await res.json().catch(() => ({}))
  return { ok: true, id: json?.id || null, recipients }
}

module.exports = { sendTrialWelcomeEmail }
