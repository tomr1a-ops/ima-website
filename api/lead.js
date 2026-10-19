// Website lead forms (home page, old trial page) post here.
// Forwards to the real IMAOS endpoint, which saves the parent as a prospect in IMAOS
// and texts the gym. The old version wrote columns the prospects table does not have
// and used a texting key this project never had, so nothing was saved or sent.

const IMAOS_URL = 'https://imaos-next.vercel.app/api/website-question'

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const b = req.body || {}
  const children = String(b.children || '').trim()
  const message = String(b.message || '').trim()
  const payload = {
    first_name: b.firstName || b.first_name || '',
    last_name: b.lastName || b.last_name || '',
    email: b.email || '',
    phone: b.phone || '',
    child_ages: children ? `${children} child(ren)` : '',
    message,
    sms_consent: b.sms_consent === true || b.sms_consent === 'true',
    studio_slug: 'ima',
    source: String(b.source || 'website-form').replace(/-/g, '_'),
  }

  try {
    const r = await fetch(IMAOS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await r.json().catch(() => ({}))
    if (r.ok && data.ok) return res.status(200).json({ success: true })
    console.error('[IMA lead] IMAOS said', r.status, JSON.stringify(data))
    return res.status(r.status >= 400 && r.status < 500 ? r.status : 502).json({ success: false, error: data.error || 'Could not send' })
  } catch (err) {
    console.error('[IMA lead] forward failed:', err.message)
    return res.status(502).json({ success: false, error: 'Could not send' })
  }
}
