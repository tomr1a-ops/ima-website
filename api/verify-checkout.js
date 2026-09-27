const { sbFetch, requireSupabaseEnv } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { session_id, lead_id } = req.body || {};
  if (!session_id || !lead_id) return res.status(400).json({ error: 'Missing session_id or lead_id' });

  console.log('[verify-checkout] session_id:', session_id, '| lead_id:', lead_id);

  try {
    requireSupabaseEnv();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const leadRes = await sbFetch(`leads?id=eq.${encodeURIComponent(lead_id)}&select=id,status,stripe_session_id&limit=1`, { method: 'GET' });
  const lead = Array.isArray(leadRes.data) ? leadRes.data[0] : null;

  if (!lead) {
    console.warn('[verify-checkout] lead not found:', lead_id);
    return res.json({ ok: false, reason: 'lead not found' });
  }

  if (lead.stripe_session_id) {
    console.log('[verify-checkout] already processed, skipping');
    return res.json({ ok: true, reason: 'already processed' });
  }

  // 2. Verify Stripe session
  const stripeKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_PLATFORM_SECRET_KEY;
  if (!stripeKey) {
    console.error('[verify-checkout] no Stripe key');
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  let session;
  try {
    const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(session_id)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    const text = await stripeRes.text();
    try {
      session = text ? JSON.parse(text) : null;
    } catch {
      session = null;
    }
    if (!stripeRes.ok || !session) {
      const msg = session?.error?.message || text || `Stripe HTTP ${stripeRes.status}`;
      throw new Error(msg);
    }
  } catch (e) {
    console.error('[verify-checkout] Stripe session fetch failed:', e.message);
    return res.status(400).json({ error: 'Could not retrieve session: ' + e.message });
  }

  if (session.payment_status !== 'paid') {
    console.log('[verify-checkout] session not paid:', session.payment_status);
    return res.json({ ok: false, reason: 'payment_status: ' + session.payment_status });
  }

  console.log('[verify-checkout] ✅ payment confirmed for lead:', lead_id, '| amount:', session.amount_total);

  await sbFetch(`leads?id=eq.${encodeURIComponent(lead_id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'paid', stripe_session_id: session_id, paid_at: new Date().toISOString() }),
  });

  return res.json({ ok: true, payment_status: session.payment_status });
};
