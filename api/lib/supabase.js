const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

function requireSupabaseEnv() {
  if (!SUPABASE_URL) throw new Error('SUPABASE_URL missing')
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing')
}

function restUrl(path) {
  return `${SUPABASE_URL}/rest/v1/${path.replace(/^\/+/, '')}`
}

async function sbFetch(path, options = {}) {
  requireSupabaseEnv()
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...options.headers,
  }
  const res = await fetch(restUrl(path), { ...options, headers })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  return { ok: res.ok, status: res.status, text, data: json }
}

module.exports = {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  sbFetch,
  requireSupabaseEnv,
}
