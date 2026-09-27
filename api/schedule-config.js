const { sbFetch, requireSupabaseEnv } = require('./lib/supabase')

const IMA_STUDIO_ID = 'ec356e58-a649-4fd3-a098-ebe91f396d84'

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
    const studioRes = await sbFetch(
      `studio_config?id=eq.${encodeURIComponent(IMA_STUDIO_ID)}&select=id,studio_name,slug,primary_color,logo_url,timezone&limit=1`,
      { method: 'GET' }
    )
    const studio = Array.isArray(studioRes.data) ? studioRes.data[0] : null
    if (!studio) return json(res, 404, { error: 'Studio not found' })

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
        id: studio.id,
        name: studio.studio_name,
        slug: 'ima',
        primary_color: studio.primary_color || '#00ffb4',
        logo_url: studio.logo_url || null,
        timezone: studio.timezone || 'America/New_York',
      },
      classes: available,
    })
  } catch (err) {
    console.error('[schedule-config] Error:', err.message)
    return json(res, 500, { error: 'Server error' })
  }
}
