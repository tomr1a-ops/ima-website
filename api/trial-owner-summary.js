const { maybeSendTrialScheduledOwnerSummary } = require('./lib/send-trial-scheduled-owner-summary')

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

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, {})
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  let body
  try {
    body = await parseBody(req)
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' })
  }

  const leadId = String(body?.lead_id || '').trim()
  const trigger = String(body?.trigger || '').trim() || 'manual'
  if (!leadId) return json(res, 400, { error: 'lead_id is required' })

  try {
    const result = await maybeSendTrialScheduledOwnerSummary(leadId, trigger)
    if (!result.ok) {
      const status = Number.isFinite(result.status) ? result.status : 500
      return json(res, status, result)
    }
    return json(res, 200, result)
  } catch (err) {
    console.error('[trial-owner-summary] Error:', err.message)
    return json(res, 500, { error: 'Server error' })
  }
}
