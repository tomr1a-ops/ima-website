// Trial page drop-off events (trial-v2.html sends these with navigator.sendBeacon).
// Our own copy of the funnel counts, so we do not depend on Meta for them.
//
// FAIL SOFT, STORES NOTHING YET. No suitable table exists in the IMAOS database:
// pixel_events has the right shape but has no row security and the public browser key can read,
// change and delete it, and it belongs to the retired website builder. The table this will write to
// is proposed in docs/proposed-migrations/20261021_trial_page_events.sql. Until that is applied,
// this endpoint checks the event, accepts it and does nothing with it.
//
// Never stores personal data: the page sends event and field names only, and anything not on the
// lists below is dropped here as well.

const EVENTS = new Set([
  'TrialPageLoaded',
  'TrialOfferSeen',
  'TrialFormSeen',
  'TrialFormStarted',
  'TrialFieldParentFirstName',
  'TrialFieldParentLastName',
  'TrialFieldPhone',
  'TrialFieldEmail',
  'TrialFieldChildFirstName',
  'TrialFieldChildLastName',
  'TrialFieldChildAge',
  'TrialSubmitTapped',
  'TrialFormError',
  'TrialCheckoutFailed',
  'TrialLeftForStripe',
])
const FIELDS = new Set(['parent_first_name', 'parent_last_name', 'phone', 'email', 'child_first_name', 'child_last_name', 'child_age'])
const ERRORS = new Set(['missing_or_invalid', 'checkout_failed'])

function short(v, n) {
  return typeof v === 'string' && v ? v.slice(0, n) : null
}

// The row the proposed table will take, built only from known names.
function toRow(b) {
  if (!b || typeof b !== 'object' || !EVENTS.has(b.event)) return null
  const p = b.params && typeof b.params === 'object' ? b.params : {}
  const fields = typeof p.fields === 'string' ? p.fields.split(',').filter((f) => FIELDS.has(f)) : []
  return {
    visit_id: short(b.visit, 64),
    event_name: b.event,
    field_name: FIELDS.has(p.field) ? p.field : null,
    error_kind: ERRORS.has(p.error) ? p.error : null,
    error_fields: fields.length ? fields : null,
    ms_since_load: Number.isFinite(b.ms) && b.ms >= 0 ? Math.min(Math.round(b.ms), 86400000) : null,
    page: short(b.page, 100),
    utm_source: short(b.utm_source, 200),
    utm_campaign: short(b.utm_campaign, 200),
    utm_content: short(b.utm_content, 200),
    is_test: b.test === true,
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  let b = req.body
  // sendBeacon posts text/plain so the browser never needs a preflight; parse it here.
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b)
    } catch {
      b = null
    }
  }
  const row = toRow(b)
  if (!row) return res.status(400).json({ ok: false })
  // Not stored until the proposed table exists (see the note at the top).
  return res.status(202).json({ ok: true, stored: false })
}
