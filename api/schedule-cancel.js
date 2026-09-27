const { sbFetch, requireSupabaseEnv } = require('./lib/supabase')

const IMA_STUDIO_ID = 'ec356e58-a649-4fd3-a098-ebe91f396d84'

function json(res, code, body) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, {})
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const { reservation_id } = req.body || {}
  if (!reservation_id) return json(res, 400, { error: 'Missing reservation_id' })

  try {
    requireSupabaseEnv()
    const reservationRes = await sbFetch(
      `reservations_v2?id=eq.${encodeURIComponent(reservation_id)}&studio_id=eq.${encodeURIComponent(IMA_STUDIO_ID)}&select=id,class_id,status&limit=1`,
      { method: 'GET' }
    )
    const reservation = Array.isArray(reservationRes.data) ? reservationRes.data[0] : null
    if (!reservation) return json(res, 404, { error: 'Reservation not found' })
    if (reservation.status === 'cancelled') return json(res, 200, { success: true })

    await sbFetch(`reservations_v2?id=eq.${encodeURIComponent(reservation_id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'cancelled' }),
    })

    const clsRes = await sbFetch(`classes?id=eq.${encodeURIComponent(reservation.class_id)}&select=current_enrollment&limit=1`, { method: 'GET' })
    const cls = Array.isArray(clsRes.data) ? clsRes.data[0] : null
    const current = Number(cls?.current_enrollment || 0)
    if (current > 0) {
      await sbFetch(`classes?id=eq.${encodeURIComponent(reservation.class_id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ current_enrollment: current - 1 }),
      })
    }

    return json(res, 200, { success: true })
  } catch (err) {
    console.error('[schedule-cancel] Error:', err.message)
    return json(res, 500, { error: 'Server error' })
  }
}
