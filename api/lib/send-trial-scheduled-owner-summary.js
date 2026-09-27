const { sbFetch, requireSupabaseEnv } = require('./supabase')

const OWNER_EMAIL = 'tom@imaimpact.com'
const IMA_STUDIO_NAME = 'Impact Martial Athletics'
const MARKER_PREFIX = '[OWNER_SUMMARY_SENT_AT:'

function toIsoDayLabel(dateStr) {
  if (!dateStr) return 'n/a'
  const d = new Date(`${dateStr}T12:00:00`)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

function toTimeLabel(timeStr) {
  if (!timeStr) return 'n/a'
  const [h, m] = String(timeStr).split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m || 0).padStart(2, '0')} ${ampm}`
}

function childNameFromLead(child, fallbackLast) {
  const first = String(child?.first || child?.first_name || '').trim()
  const lastRaw = String(child?.last || child?.last_name || '').trim()
  const last = lastRaw || String(fallbackLast || '').trim()
  return [first, last].filter(Boolean).join(' ').trim()
}

function normalizeName(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function expectedChildCount(lead) {
  const fromNum = Number.parseInt(String(lead?.num_children || ''), 10)
  if (Number.isFinite(fromNum) && fromNum > 0) return fromNum
  if (Array.isArray(lead?.children) && lead.children.length > 0) return lead.children.length
  return 1
}

function hasMarker(message) {
  return String(message || '').includes(MARKER_PREFIX)
}

function markerValue(nowIso) {
  return `${MARKER_PREFIX}${nowIso}]`
}

async function sendResendEmail(payload) {
  const key = String(process.env.RESEND_API_KEY || '').trim()
  if (!key) return { ok: false, skipped: true, error: 'RESEND_API_KEY missing' }
  const from = String(process.env.RESEND_FROM_EMAIL || '').trim() || 'Impact Martial Athletics <leads@ima-os.com>'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...payload, from }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: text || `HTTP ${res.status}` }
  }
  const data = await res.json().catch(() => ({}))
  return { ok: true, id: data?.id || null, from }
}

async function maybeSendTrialScheduledOwnerSummary(leadId, trigger) {
  requireSupabaseEnv()
  const safeLeadId = String(leadId || '').trim()
  if (!safeLeadId) return { ok: false, error: 'lead_id required' }

  const leadRes = await sbFetch(
    `leads?id=eq.${encodeURIComponent(safeLeadId)}&select=id,first_name,last_name,email,phone,num_children,children,message&limit=1`,
    { method: 'GET' }
  )
  const lead = Array.isArray(leadRes.data) ? leadRes.data[0] : null
  if (!lead) return { ok: false, status: 404, error: 'Lead not found' }

  if (hasMarker(lead.message)) {
    return { ok: true, skipped: true, reason: 'already-sent', expected: expectedChildCount(lead), booked: null }
  }

  const reservationRes = await sbFetch(
    `reservations_v2?lead_id=eq.${encodeURIComponent(safeLeadId)}&status=eq.reserved&is_trial=is.true&select=id,guest_name,class_id,member_id,created_at&order=created_at.asc`,
    { method: 'GET' }
  )
  const reservations = Array.isArray(reservationRes.data) ? reservationRes.data : []
  const expected = expectedChildCount(lead)
  if (reservations.length < expected) {
    return { ok: true, skipped: true, reason: 'family-not-complete', expected, booked: reservations.length }
  }

  const nowIso = new Date().toISOString()
  const marker = markerValue(nowIso)
  const previousMessage = lead.message == null ? null : String(lead.message)
  const nextMessage = previousMessage ? `${previousMessage}\n${marker}` : marker

  const guardPath =
    previousMessage == null
      ? `leads?id=eq.${encodeURIComponent(safeLeadId)}&message=is.null`
      : `leads?id=eq.${encodeURIComponent(safeLeadId)}&message=eq.${encodeURIComponent(previousMessage)}`

  const markRes = await sbFetch(guardPath, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ message: nextMessage }),
  })
  const marked = Array.isArray(markRes.data) ? markRes.data : []
  if (!markRes.ok || marked.length === 0) {
    const leadAgainRes = await sbFetch(
      `leads?id=eq.${encodeURIComponent(safeLeadId)}&select=id,message&limit=1`,
      { method: 'GET' }
    )
    const leadAgain = Array.isArray(leadAgainRes.data) ? leadAgainRes.data[0] : null
    if (leadAgain && hasMarker(leadAgain.message)) {
      return { ok: true, skipped: true, reason: 'already-sent-race', expected, booked: reservations.length }
    }
    return { ok: false, error: 'Could not acquire idempotency marker' }
  }

  const classIds = [...new Set(reservations.map((r) => r.class_id).filter(Boolean))]
  let classMap = {}
  if (classIds.length > 0) {
    const classRes = await sbFetch(
      `classes?id=in.(${classIds.map((id) => encodeURIComponent(id)).join(',')})&select=id,name,date,start_time`,
      { method: 'GET' }
    )
    const classes = Array.isArray(classRes.data) ? classRes.data : []
    classMap = classes.reduce((acc, c) => {
      acc[c.id] = c
      return acc
    }, {})
  }

  const leadChildren = Array.isArray(lead.children) ? lead.children : []
  const childMetaByName = {}
  leadChildren.forEach((c) => {
    const name = normalizeName(childNameFromLead(c, lead.last_name))
    if (!name) return
    childMetaByName[name] = {
      age: c?.age != null ? c.age : 'n/a',
    }
  })

  const childRows = reservations.slice(0, expected).map((r) => {
    const childName = String(r.guest_name || 'n/a').trim()
    const childMeta = childMetaByName[normalizeName(childName)] || { age: 'n/a' }
    const cls = classMap[r.class_id] || {}
    return {
      name: childName || 'n/a',
      age: childMeta.age,
      className: cls.name || 'n/a',
      date: toIsoDayLabel(cls.date),
      time: toTimeLabel(cls.start_time),
    }
  })

  const parentName = [lead.first_name || '', lead.last_name || ''].join(' ').trim() || 'n/a'
  const subject = `New trial scheduled: ${parentName}`
  const htmlRows = childRows
    .map(
      (c) =>
        `<li><strong>${c.name}</strong> (age ${c.age ?? 'n/a'}) — ${c.className} on ${c.date} at ${c.time}</li>`
    )
    .join('')
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a">
    <h2>New trial scheduled</h2>
    <p><strong>Studio:</strong> ${IMA_STUDIO_NAME}</p>
    <p><strong>Lead ID:</strong> ${safeLeadId}</p>
    <p><strong>Parent:</strong> ${parentName}</p>
    <p><strong>Email:</strong> ${lead.email || 'n/a'}</p>
    <p><strong>Phone:</strong> ${lead.phone || 'n/a'}</p>
    <p><strong>Children scheduled:</strong></p>
    <ul>${htmlRows || '<li>n/a</li>'}</ul>
    <p><em>Trigger: ${String(trigger || 'unknown')}</em></p>
  </body></html>`

  const sendRes = await sendResendEmail({
    to: [OWNER_EMAIL],
    subject,
    html,
  })

  if (!sendRes.ok) {
    await sbFetch(
      `leads?id=eq.${encodeURIComponent(safeLeadId)}&message=eq.${encodeURIComponent(nextMessage)}`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ message: previousMessage }),
      }
    )
    return { ok: false, error: sendRes.error || 'Failed to send owner summary email' }
  }

  return {
    ok: true,
    sent: true,
    expected,
    booked: reservations.length,
    from: sendRes.from,
    emailId: sendRes.id || null,
  }
}

module.exports = { maybeSendTrialScheduledOwnerSummary }
