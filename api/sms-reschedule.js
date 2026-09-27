const { sbFetch, requireSupabaseEnv } = require('./lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { prospect_id, studio_id, new_class_name, new_class_date, reschedule_link } = req.body;
  if (!prospect_id || !new_class_date) {
    return res.status(400).json({ error: 'Missing required fields: prospect_id, new_class_date' });
  }

  try {
    requireSupabaseEnv();
    const now     = new Date();
    const newDate = new Date(new_class_date);

    // 1. Find the most recent active sequence for this prospect
    const seqRes = await sbFetch(
      `sms_sequences?prospect_id=eq.${encodeURIComponent(prospect_id)}&status=eq.active&order=created_at.desc&limit=1`,
      { method: 'GET' }
    );
    const seqData = seqRes.data;
    const sequence = Array.isArray(seqData) ? seqData[0] : null;
    if (!sequence) {
      return res.status(404).json({ error: 'No active SMS sequence found for this prospect' });
    }

    // 2. Cancel all pending reminder messages (old class dates)
    const reminderKeys = ['m3_confirmed', 'm4_3day_reminder', 'm5_1day_reminder', 'm6_dayof_rsvp'];
    await Promise.all(
      reminderKeys.map((key) =>
        sbFetch(
          `sms_messages?sequence_id=eq.${encodeURIComponent(sequence.id)}&message_key=eq.${encodeURIComponent(key)}&status=eq.pending`,
          { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'cancelled' }) }
        )
      )
    );

    // 3. Build reschedule link with all params for future reminders
    const relink = reschedule_link ||
      `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/schedule?phone=${encodeURIComponent(sequence.parent_phone || '')}&kids=${encodeURIComponent(sequence.child_name || '')}&lead_id=${prospect_id}&reschedule=true`;

    // 4. Build new reminder schedule around the new class date
    const formattedDate = newDate.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
    const formattedTime = newDate.toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit',
    });

    const threeDaysBefore = new Date(newDate.getTime() - 3 * 24 * 60 * 60 * 1000);
    const oneDayBefore    = new Date(newDate.getTime() - 24 * 60 * 60 * 1000);
    const dayOf           = new Date(newDate);
    dayOf.setHours(8, 0, 0, 0);

    const messages = [
      {
        sequence_id: sequence.id,
        prospect_id,
        studio_id:   studio_id || sequence.studio_id,
        message_key: 'm3_confirmed',
        body: `You're all set! ${sequence.child_name}'s trial class has been rescheduled to ${new_class_name || 'class'} on ${formattedDate} at ${formattedTime}. See you then!`,
        send_at: now.toISOString(),
        status: 'pending',
      },
      {
        sequence_id: sequence.id,
        prospect_id,
        studio_id:   studio_id || sequence.studio_id,
        message_key: 'm4_3day_reminder',
        body: `Looking forward to training with ${sequence.child_name} on ${formattedDate} at ${formattedTime}! Need to reschedule? Click here: ${relink}`,
        send_at: threeDaysBefore.toISOString(),
        status: threeDaysBefore > now ? 'pending' : 'cancelled',
      },
      {
        sequence_id: sequence.id,
        prospect_id,
        studio_id:   studio_id || sequence.studio_id,
        message_key: 'm5_1day_reminder',
        body: `Reminder — ${sequence.child_name}'s trial class is tomorrow, ${formattedDate} at ${formattedTime}. Need to reschedule? ${relink}`,
        send_at: oneDayBefore.toISOString(),
        status: oneDayBefore > now ? 'pending' : 'cancelled',
      },
      {
        sequence_id: sequence.id,
        prospect_id,
        studio_id:   studio_id || sequence.studio_id,
        message_key: 'm6_dayof_rsvp',
        body: `Good morning! ${sequence.child_name}'s trial class is today at ${formattedTime}. Reply YES to confirm, or reschedule here: ${relink}`,
        send_at: dayOf.toISOString(),
        status: dayOf > now ? 'pending' : 'cancelled',
      },
    ];

    // 5. Insert new messages
    await sbFetch('sms_messages', { method: 'POST', body: JSON.stringify(messages) });

    // 6. Update sequence with new class info
    await sbFetch(`sms_sequences?id=eq.${encodeURIComponent(sequence.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        class_name:   new_class_name || sequence.class_name,
        class_date:   new_class_date,
        scheduled_at: now.toISOString(),
        updated_at:   now.toISOString(),
      }),
    })

    console.log('[sms-reschedule] Rescheduled sequence', sequence.id, 'for prospect', prospect_id, '→', new_class_date);
    res.json({ success: true, sequence_id: sequence.id });

  } catch (err) {
    console.error('[sms-reschedule] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
