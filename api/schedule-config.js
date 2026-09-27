const { sbFetch, requireSupabaseEnv } = require('./lib/supabase')

const IMA_STUDIO_ID = 'ec356e58-a649-4fd3-a098-ebe91f396d84'
const IMA_STUDIO_NAME = 'Impact Martial Athletics'
const IMA_PRIMARY_COLOR = '#00ffb4'
const IMA_TIMEZONE = 'America/New_York'

function json(res, code, body) {
  res.statusCode = code
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

    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    const cutoff = new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000)
    const cutoffStr = cutoff.toISOString().slice(0, 10)

    const classesRes = await sbFetch(
      `classes?studio_id=eq.${encodeURIComponent(IMA_STUDIO_ID)}&deleted_at=is.null&date=gte.${todayStr}&date=lte.${cutoffStr}&select=id,name,date,start_time,end_time,max_capacity,current_enrollment,instructor,is_trial&order=date.asc,start_time.asc`,
      { method: 'GET' }
    )
    const classes = Array.isArray(classesRes.data) ? classesRes.data : []
    const available = classes
      .filter((c) => Number(c.current_enrollment || 0) < Number(c.max_capacity || 0))
      .map((c) => ({ ...c, spots_left: Number(c.max_capacity || 0) - Number(c.current_enrollment || 0) }))

    return json(res, 200, {
      studio: {
        id: IMA_STUDIO_ID,
        name: IMA_STUDIO_NAME,
        slug: 'ima',
        primary_color: IMA_PRIMARY_COLOR,
        logo_url: null,
        timezone: IMA_TIMEZONE,
      },
      classes: available,
    })
  } catch (err) {
    console.error('[schedule-config] Error:', err.message)
    return json(res, 500, { error: 'Server error' })
  }
}
