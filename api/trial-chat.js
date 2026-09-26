const { sbFetch, requireSupabaseEnv } = require('./lib/supabase')

const IMA_STUDIO_ID = 'ec356e58-a649-4fd3-a098-ebe91f396d84'
const IMA_STUDIO_NAME = 'Impact Martial Athletics'

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
  const digits = String(raw || '').replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`
  return raw
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

  const visitor_name = String(body.visitor_name || '').trim()
  const visitor_phone = normalizePhone(String(body.visitor_phone || '').trim())
  const message = String(body.message || '').trim()
  if (!visitor_name || !visitor_phone || !message) {
    return json(res, 400, { error: 'Missing visitor_name, visitor_phone, or message' })
  }

  let conversationId = null
  const find = await sbFetch(
    `conversations?studio_id=eq.${encodeURIComponent(IMA_STUDIO_ID)}&contact_type=eq.visitor&visitor_phone=eq.${encodeURIComponent(
      visitor_phone,
    )}&select=id&order=last_message_at.desc&limit=1`,
    { method: 'GET' },
  )
  if (Array.isArray(find.data) && find.data[0]?.id) {
    conversationId = String(find.data[0].id)
  }

  if (!conversationId) {
    const inserted = await sbFetch('conversations', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        studio_id: IMA_STUDIO_ID,
        contact_type: 'visitor',
        conversation_type: 'individual',
        visitor_name,
        visitor_phone,
        last_message_at: new Date().toISOString(),
        last_message_preview: message.slice(0, 100),
        title: `${visitor_name} — ${IMA_STUDIO_NAME}`,
      }),
    })
    if (Array.isArray(inserted.data) && inserted.data[0]?.id) {
      conversationId = String(inserted.data[0].id)
    }
  } else {
    await sbFetch(`conversations?id=eq.${encodeURIComponent(conversationId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        last_message_at: new Date().toISOString(),
        last_message_preview: message.slice(0, 100),
      }),
    })
  }

  if (conversationId) {
    await sbFetch('messages', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        conversation_id: conversationId,
        sender_type: 'visitor',
        sender_name: visitor_name,
        message_text: message,
        message_type: 'chat',
        read_by_coach: false,
        created_at: new Date().toISOString(),
      }),
    })
  }

  return json(res, 200, { success: true, conversation_id: conversationId })
}
