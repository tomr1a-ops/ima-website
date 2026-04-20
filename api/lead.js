module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const timestamp = new Date().toISOString();

    const lead = {
      timestamp,
      firstName: body.firstName || '',
      lastName: body.lastName || '',
      email: body.email || '',
      phone: body.phone || '',
      numChildren: body.numChildren || '1',
      child1Name: body.child1Name || '',
      child1Age: body.child1Age || '',
      child2Name: body.child2Name || '',
      child2Age: body.child2Age || '',
      child3Name: body.child3Name || '',
      child3Age: body.child3Age || '',
      child4Name: body.child4Name || '',
      child4Age: body.child4Age || '',
      message: body.message || '',
      subject: body.subject || '',
      smsConsent: body.smsConsent === true || body.smsConsent === 'on',
      privacyConsent: body.privacyConsent === true || body.privacyConsent === 'on',
      source: body.source || 'website',
      submittedAt: body.submittedAt || timestamp,
      ip: req.headers['x-forwarded-for'] || req.connection?.remoteAddress || 'unknown',
    };

    console.log('[IMA Lead Submission]', JSON.stringify(lead, null, 2));

    return res.status(200).json({ success: true, message: 'Lead received successfully' });
  } catch (err) {
    console.error('[IMA Lead Error]', err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
};
