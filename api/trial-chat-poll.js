const { sbFetch, requireSupabaseEnv } = require('./lib/supabase')

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, {})
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })

  try {
    requireSupabaseEnv()
  } catch (err) {
    return json(res, 500, { error: err.message })
  }

  const conversation_id = String(req.query?.conversation_id || '').trim()
  const after = String(req.query?.after || '').trim()
  if (!conversation_id) return json(res, 400, { error: 'Missing conversation_id' })

  const since =
    after && !Number.isNaN(Date.parse(after)) ? after : new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const q =
    `messages?conversation_id=eq.${encodeURIComponent(conversation_id)}` +
    `&sender_type=in.(coach,studio)&created_at=gt.${encodeURIComponent(since)}` +
    '&select=id,message_text,sender_name,sender_type,created_at&order=created_at.asc'

  const out = await sbFetch(q, { method: 'GET' })
  return json(res, out.ok ? 200 : 500, { messages: Array.isArray(out.data) ? out.data : [] })
}
