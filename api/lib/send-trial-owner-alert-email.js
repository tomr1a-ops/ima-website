const OWNER_EMAIL = 'tomr1a@gmail.com'

function toList(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((c) => {
      const first = String(c?.first || c?.first_name || '').trim()
      const last = String(c?.last || c?.last_name || '').trim()
      const age = c?.age != null ? String(c.age).trim() : ''
      const full = [first, last].filter(Boolean).join(' ').trim()
      if (!full) return null
      return age ? `${full} (age ${age})` : full
    })
    .filter(Boolean)
}

async function sendTrialOwnerAlertEmail({
  studioName,
  firstName,
  lastName,
  email,
  phone,
  numChildren,
  children,
  leadId,
  message,
  referralSource,
}) {
  const key = String(process.env.RESEND_API_KEY || '').trim()
  if (!key) return { ok: false, skipped: true, error: 'RESEND_API_KEY missing' }

  const kids = toList(children)
  const subject = `New trial signup: ${firstName || ''} ${lastName || ''}`.trim()
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a">
    <h2>New trial signup</h2>
    <p><strong>Studio:</strong> ${studioName || 'Impact Martial Athletics'}</p>
    <p><strong>Parent:</strong> ${[firstName || '', lastName || ''].join(' ').trim()}</p>
    <p><strong>Email:</strong> ${email || ''}</p>
    <p><strong>Phone:</strong> ${phone || ''}</p>
    <p><strong>Children:</strong> ${numChildren || 1}</p>
    <p><strong>Child details:</strong> ${kids.length ? kids.join(', ') : 'n/a'}</p>
    <p><strong>Referral source:</strong> ${referralSource || 'n/a'}</p>
    <p><strong>Lead ID:</strong> ${leadId || 'n/a'}</p>
    <p><strong>Message:</strong> ${message || 'n/a'}</p>
  </body></html>`

  const body = {
    from: process.env.RESEND_FROM_EMAIL || 'Impact Martial Athletics <info@imaimpact.com>',
    to: [OWNER_EMAIL],
    subject,
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
  return { ok: true, id: json?.id || null }
}

module.exports = { sendTrialOwnerAlertEmail }
