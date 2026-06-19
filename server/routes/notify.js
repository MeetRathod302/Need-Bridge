import { Router } from 'express';
import webpush from 'web-push';
import { db } from '../db/client.js';

export const notifyRouter = Router();

webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL ?? 'admin@needbridge.in'}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

notifyRouter.post('/subscribe', async (req, res, next) => {
  const { subscription, org_id } = req.body;

  if (!subscription?.endpoint || !org_id) {
    return res.status(400).json({ error: 'subscription object and org_id required' });
  }

  try {
    const { error } = await db.from('push_subscriptions').upsert(
      { org_id, endpoint: subscription.endpoint, keys: subscription.keys },
      { onConflict: 'endpoint' }
    );

    if (error) throw error;

    res.status(201).json({ registered: true });
  } catch (err) {
    next(err);
  }
});

notifyRouter.post('/send', async (req, res, next) => {
  const { org_id, title, body, url, urgent } = req.body;

  if (!org_id || !title) {
    return res.status(400).json({ error: 'org_id and title required' });
  }

  try {
    const { data: subs, error } = await db
      .from('push_subscriptions')
      .select('endpoint, keys')
      .eq('org_id', org_id);

    if (error) throw error;
    if (!subs?.length) return res.json({ sent: 0, message: 'No active subscriptions for this org' });

    const payload = JSON.stringify({ title, body: body ?? '', url: url ?? '/', urgent: urgent ?? false });

    const results = await Promise.allSettled(
      subs.map(sub =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          payload,
          { TTL: 3600 }
        )
      )
    );

    const sent = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.length - sent;

    // Clean up expired subscriptions
    const expiredEndpoints = results
      .map((r, i) => r.status === 'rejected' && r.reason?.statusCode === 410 ? subs[i].endpoint : null)
      .filter(Boolean);

    if (expiredEndpoints.length > 0) {
      await db.from('push_subscriptions').delete().in('endpoint', expiredEndpoints);
    }

    res.json({ sent, failed, total: results.length });
  } catch (err) {
    next(err);
  }
});

notifyRouter.post('/broadcast-match', async (req, res, next) => {
  const { source_org_id, target_org_id, item_name, score, distance_km } = req.body;

  if (!source_org_id || !target_org_id) {
    return res.status(400).json({ error: 'source_org_id and target_org_id required' });
  }

  try {
    const notifyBoth = [
      { org_id: source_org_id, title: `✓ Match Found — ${Math.round(score)}%`, body: `${item_name} matched ${distance_km.toFixed(1)} km away. Open NeedBridge to connect.`, urgent: score >= 90 },
      { org_id: target_org_id, title: `📡 Resource Available Nearby`, body: `${item_name} available ${distance_km.toFixed(1)} km from you. Tap to view details.`, urgent: false }
    ];

    const responses = await Promise.allSettled(
      notifyBoth.map(n =>
        fetch(`${process.env.APP_URL ?? 'http://localhost:3001'}/api/notify/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(n)
        }).then(r => r.json())
      )
    );

    res.json({ notifications_dispatched: notifyBoth.length, results: responses.map(r => r.value ?? r.reason) });
  } catch (err) {
    next(err);
  }
});
