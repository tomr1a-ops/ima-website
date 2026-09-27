const { sbFetch, requireSupabaseEnv } = require('./lib/supabase')

const IMA_STUDIO_ID = 'ec356e58-a649-4fd3-a098-ebe91f396d84'
const IMA_STUDIO_NAME = 'Impact Martial Athletics'

function json(res, code, body) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
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

function childSlug(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function formatDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`)
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
}

function formatTime(timeStr) {
  if (!timeStr) return ''
  const [h, m] = timeStr.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

async function sendSms(to, text) {
  const key = String(process.env.TELNYX_API_KEY || '').trim()
  const from = String(process.env.TELNYX_SMS_NUMBER || '').trim()
  if (!key || !from || !to || !text) return { ok: false, skipped: true }
  const r = await fetch('https://api.telnyx.com/v2/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, text, messaging_profile_id: process.env.TELNYX_MESSAGING_PROFILE_ID || undefined }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) return { ok: false, error: d?.errors?.[0]?.detail || `HTTP ${r.status}` }
  return { ok: true, id: d?.data?.id || null }
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

  const { class_id, first_name, last_name, phone, lead_id, child_name, child_dob, child_gender } = body || {}
  if (!class_id) return json(res, 400, { error: 'Missing class_id' })
  if (!first_name) return json(res, 400, { error: 'Missing first_name' })
  if (!phone) return json(res, 400, { error: 'Missing phone' })

  try {
    const clsRes = await sbFetch(
      `classes?id=eq.${encodeURIComponent(class_id)}&studio_id=eq.${encodeURIComponent(IMA_STUDIO_ID)}&deleted_at=is.null&select=id,name,date,start_time,end_time,max_capacity,current_enrollment&limit=1`,
      { method: 'GET' }
    )
    const cls = Array.isArray(clsRes.data) ? clsRes.data[0] : null
    if (!cls) return json(res, 404, { error: 'Class not found' })
    if (Number(cls.current_enrollment || 0) >= Number(cls.max_capacity || 0)) {
      return json(res, 409, { error: 'Class is full' })
    }

    const guestName = child_name || [first_name, last_name].filter(Boolean).join(' ') || 'Guest'
    const memberFirst = first_name || 'Guest'
    const memberLast = last_name || ''
    const childKey = childSlug(child_name || `${memberFirst} ${memberLast}`) || 'child'
    const externalId = lead_id
      ? `trial_lead_${lead_id}_${childKey}`
      : `trial_${IMA_STUDIO_ID}_${childKey}_${String(phone || '').replace(/\D/g, '')}`

    let memberId = null
    const byExt = await sbFetch(
      `members?external_id=eq.${encodeURIComponent(externalId)}&studio_id=eq.${encodeURIComponent(IMA_STUDIO_ID)}&deleted_at=is.null&select=id&limit=1`,
      { method: 'GET' }
    )
    if (Array.isArray(byExt.data) && byExt.data[0]?.id) memberId = byExt.data[0].id

    if (!memberId && child_name) {
      const parts = child_name.trim().split(/\s+/)
      const cFirst = parts[0] || ''
      const cLast = parts.slice(1).join(' ') || ''
      if (cFirst) {
        const byChild = await sbFetch(
          `members?studio_id=eq.${encodeURIComponent(IMA_STUDIO_ID)}&first_name=ilike.${encodeURIComponent(cFirst)}&last_name=ilike.${encodeURIComponent(cLast)}&deleted_at=is.null&select=id&limit=1`,
          { method: 'GET' }
        )
        if (Array.isArray(byChild.data) && byChild.data[0]?.id) memberId = byChild.data[0].id
      }
    }

    if (!memberId && memberFirst !== 'Guest') {
      const byParent = await sbFetch(
        `members?studio_id=eq.${encodeURIComponent(IMA_STUDIO_ID)}&first_name=ilike.${encodeURIComponent(memberFirst)}&last_name=ilike.${encodeURIComponent(memberLast || '')}&deleted_at=is.null&select=id&limit=1`,
        { method: 'GET' }
      )
      if (Array.isArray(byParent.data) && byParent.data[0]?.id) memberId = byParent.data[0].id
    }

    if (!memberId) {
      const cParts = child_name ? child_name.trim().split(/\s+/) : []
      const createFirst = cParts.length > 0 ? cParts[0] : memberFirst
      const createLast = cParts.length > 1 ? cParts.slice(1).join(' ') : memberLast || null
      const insertPayload = {
        studio_id: IMA_STUDIO_ID,
        external_id: externalId,
        first_name: createFirst,
        last_name: createLast,
        plan_code: 'trial',
        plan_name: 'Trial',
        status: 'not_scheduled',
      }
      if (child_dob) insertPayload.date_of_birth = child_dob
      const newMember = await sbFetch('members', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(insertPayload),
      })
      if (Array.isArray(newMember.data) && newMember.data[0]?.id) memberId = newMember.data[0].id
    }

    if (memberId && child_dob) {
      await sbFetch(`members?id=eq.${encodeURIComponent(memberId)}&date_of_birth=is.null`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ date_of_birth: child_dob }),
      })
    }

    if (!memberId) {
      return json(res, 500, { error: 'Failed to resolve member before booking' })
    }

    let prospectCaptureOk = false
    let prospectDebug = { step: 'start', existingId: null, inserted: null, error: null }
    try {
      const today = `${new Date().toISOString().slice(0, 10)}T00:00:00+00:00`
      let parentName = [first_name, last_name].filter(Boolean).join(' ') || 'Guest'
      let parentEmail = null
      if (lead_id) {
        const leadRes = await sbFetch(
          `leads?id=eq.${encodeURIComponent(lead_id)}&select=first_name,last_name,email&limit=1`,
          { method: 'GET' }
        )
        const lead = Array.isArray(leadRes.data) ? leadRes.data[0] : null
        if (lead) {
          parentName = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || parentName
          parentEmail = lead.email || null
        }
      }

      let familyMembers = null
      let fcFirst = null
      let fcLast = null
      if (child_name) {
        const cParts = child_name.trim().split(/\s+/)
        fcFirst = cParts[0] || ''
        fcLast = cParts.slice(1).join(' ') || ''
        const fm = {
          name: child_name,
          first: fcFirst,
          last: fcLast,
          age_tier: 'child',
          relation: 'child',
          dob: child_dob || null,
          _source: 'trial_schedule',
          status: 'first_class_scheduled',
          membership: { plan: 'trial', planName: 'Trial Membership' },
        }
        if (child_gender) fm.gender = child_gender
        familyMembers = [fm]
      }

      const rawDigits = String(phone).replace(/\D/g, '')
      const phoneVariants = [...new Set([
        phone,
        rawDigits.length === 10 ? `+1${rawDigits}` : null,
        rawDigits.length === 10 ? rawDigits : null,
        rawDigits.length === 11 && rawDigits[0] === '1' ? `+${rawDigits}` : null,
        rawDigits.length === 11 && rawDigits[0] === '1' ? rawDigits.slice(1) : null,
      ].filter(Boolean))]

      let existingId = null
      if (lead_id) {
        prospectDebug.step = 'lookup-ext'
        const byExtProspect = await sbFetch(
          `prospects?external_id=eq.${encodeURIComponent(`trial_lead_${lead_id}`)}&select=id&limit=1`,
          { method: 'GET' }
        )
        if (Array.isArray(byExtProspect.data) && byExtProspect.data[0]?.id) existingId = byExtProspect.data[0].id
      }

      if (!existingId) {
        prospectDebug.step = 'lookup-phone'
        for (const ph of phoneVariants) {
          const byPhone = await sbFetch(
            `prospects?phone=eq.${encodeURIComponent(ph)}&select=id&order=deleted_at.asc.nullsfirst&limit=1`,
            { method: 'GET' }
          )
          if (Array.isArray(byPhone.data) && byPhone.data[0]?.id) {
            existingId = byPhone.data[0].id
            break
          }
        }
      }
      prospectDebug.existingId = existingId

      const patchFields = {
        status: 'first_class_scheduled',
        child_name: child_name || null,
        child_first: fcFirst,
        child_last: fcLast,
        family_members: familyMembers,
        updated_date: today,
      }

      if (existingId) {
        prospectDebug.step = 'update'
        const existingRes = await sbFetch(
          `prospects?id=eq.${encodeURIComponent(existingId)}&select=family_members,source,external_id&limit=1`,
          { method: 'GET' }
        )
        const existing = Array.isArray(existingRes.data) ? existingRes.data[0] : null
        const existingFm = Array.isArray(existing?.family_members) ? existing.family_members : []
        if (familyMembers && familyMembers.length > 0) {
          const newChild = familyMembers[0]
          const norm = String(newChild.name || '').trim().toLowerCase()
          const idx = existingFm.findIndex((m) => String(m?.name || '').trim().toLowerCase() === norm)
          if (idx >= 0) {
            const merged = { ...existingFm[idx] }
            Object.keys(newChild).forEach((k) => {
              if (newChild[k] != null) merged[k] = newChild[k]
            })
            existingFm[idx] = merged
          } else {
            existingFm.push(newChild)
          }
          patchFields.family_members = existingFm
          if (!existing?.source || existing.source === 'trial_page') patchFields.source = 'trial_schedule'
          if (lead_id) {
            const leadExternalId = `trial_lead_${lead_id}`
            if (!existing?.external_id || existing.external_id === leadExternalId) {
              patchFields.external_id = leadExternalId
            }
          }
        }
        if (lead_id && !('external_id' in patchFields)) {
          const leadExternalId = `trial_lead_${lead_id}`
          if (!existing?.external_id || existing.external_id === leadExternalId) {
            patchFields.external_id = leadExternalId
          }
        }
        const updateRes = await sbFetch(`prospects?id=eq.${encodeURIComponent(existingId)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ ...patchFields, deleted_at: null }),
        })
        if (updateRes.ok) prospectCaptureOk = true
        else prospectDebug.error = { step: 'update', msg: updateRes.text }
      } else {
        prospectDebug.step = 'insert-core'
        const core = {
          name: parentName,
          phone,
          status: 'first_class_scheduled',
          source: 'trial_schedule',
          added_date: today,
          updated_date: today,
        }
        if (parentEmail) core.email = parentEmail
        if (lead_id) core.external_id = `trial_lead_${lead_id}`
        const insertRes = await sbFetch('prospects', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(core),
        })
        const inserted = Array.isArray(insertRes.data) ? insertRes.data[0] : null
        if (inserted?.id) {
          prospectCaptureOk = true
          prospectDebug.inserted = inserted.id
          if (child_name || familyMembers) {
            await sbFetch(`prospects?id=eq.${encodeURIComponent(inserted.id)}`, {
              method: 'PATCH',
              headers: { Prefer: 'return=minimal' },
              body: JSON.stringify({ child_name: child_name || null, child_first: fcFirst, child_last: fcLast, family_members: familyMembers }),
            })
          }
        } else {
          prospectDebug.error = { step: 'insert-core', msg: insertRes.text }
        }
      }
    } catch (e) {
      prospectDebug.error = { step: 'exception', msg: e.message }
    }

    if (!prospectCaptureOk) {
      return json(res, 500, { error: 'Failed to capture prospect before booking' })
    }

    const reservationRes = await sbFetch('reservations_v2', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        studio_id: IMA_STUDIO_ID,
        class_id: cls.id,
        member_id: memberId,
        status: 'reserved',
        is_trial: true,
        trial_id: null,
        guest_name: guestName,
        guest_phone: phone || null,
        lead_id: lead_id || null,
      }),
    })
    const reservation = Array.isArray(reservationRes.data) ? reservationRes.data[0] : null
    if (!reservation?.id) return json(res, 500, { error: 'Failed to create reservation' })

    await sbFetch(`classes?id=eq.${encodeURIComponent(cls.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ current_enrollment: Number(cls.current_enrollment || 0) + 1 }),
    })

    if (lead_id) {
      await sbFetch(`leads?id=eq.${encodeURIComponent(lead_id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'booked' }),
      })
    }

    const dateLabel = formatDate(cls.date)
    const timeLabel = formatTime(cls.start_time)
    const fullName = [first_name, last_name].filter(Boolean).join(' ')
    const studioNotifyNum = process.env.TWILIO_TO_NUMBER
    if (studioNotifyNum) {
      const studioMsg = child_name
        ? `Trial booked: ${child_name} (parent: ${phone}) -> ${cls.name} on ${dateLabel} at ${timeLabel}`
        : `Trial class booked: ${fullName} (${phone}) -> ${cls.name} on ${dateLabel} at ${timeLabel}`
      await sendSms(studioNotifyNum, studioMsg)
    }
    const displayName = child_name || first_name
    await sendSms(normalizePhone(phone), `Hi! ${displayName} is booked for ${cls.name} at ${IMA_STUDIO_NAME} on ${dateLabel} at ${timeLabel}. We can't wait to meet you!`)

    return json(res, 200, {
      success: true,
      reservation_id: reservation.id,
      _prospect_debug: prospectDebug,
      class: {
        id: cls.id,
        name: cls.name,
        date: cls.date,
        start_time: cls.start_time,
        date_label: dateLabel,
        time_label: timeLabel,
      },
      studio_name: IMA_STUDIO_NAME,
    })
  } catch (err) {
    console.error('[schedule-book] Unhandled error:', err.message)
    return json(res, 500, { error: 'Server error' })
  }
}
