const https = require('https');

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const options = { hostname, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) } };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function supabaseInsert(record) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const body = JSON.stringify(record);
  const result = await httpsPost(
    'mxvkicuojeiapqroksfd.supabase.co',
    '/rest/v1/prospects',
    {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Prefer': 'return=minimal'
    },
    body
  );
  if (result.status >= 300) throw new Error(`Supabase ${result.status}: ${result.body}`);
  return result;
}

async function sendSMS(to, text) {
  const key = process.env.TELNYX_API_KEY;
  // Approved 10DLC number: +17542838817 — set TELNYX_PHONE_NUMBER in Vercel to match.
  const from = (process.env.TELNYX_PHONE_NUMBER || '').trim() || '+17542838817';
  if (!key) { console.warn('[IMA] Telnyx API key missing'); return; }
  const body = JSON.stringify({ from, to, text });
  const result = await httpsPost(
    'api.telnyx.com',
    '/v2/messages',
    { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
    body
  );
  if (result.status >= 300) throw new Error(`Telnyx ${result.status}: ${result.body}`);
  return result;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { firstName = '', lastName = '', email = '', phone = '', children = '', message = '', source = 'website-form', sms_consent = false } = req.body || {};

    // Insert into Supabase prospects table
    try {
      await supabaseInsert({
        studio_id: 'ec356e58',
        first_name: firstName,
        last_name: lastName,
        email,
        phone,
        source,
        stage: 'new-lead',
        notes: message,
        sms_consent: sms_consent === true || sms_consent === 'true'
      });
      console.log('[IMA] Supabase insert OK');
    } catch (err) {
      console.error('[IMA] Supabase error:', err.message);
    }

    // Send SMS to Tom and Coach Shick
    const smsText = `New lead from IMA website: ${firstName} ${lastName} - ${phone} - ${email}`;
    try {
      await Promise.all([
        sendSMS('+19546361515', smsText),
        sendSMS('+19542134478', smsText)
      ]);
      console.log('[IMA] SMS sent');
    } catch (err) {
      console.error('[IMA] SMS error:', err.message);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[IMA Lead Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
