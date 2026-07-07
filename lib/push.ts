// Web push delivery helper.
// Used by POST /api/waiting when notify=true.
// Failures are caught and logged — they never break item creation.

import webpush from 'web-push';
import { getDb } from './db';

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars are not set');
  }
  webpush.setVapidDetails('mailto:danny@athingdesign.com', pub, priv);
  vapidConfigured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
}

// Send a push notification to all stored subscriptions.
// Prunes 404/410 (expired/unsubscribed) endpoints automatically.
// Returns the number of successful deliveries.
export async function sendPushToAll(payload: PushPayload): Promise<number> {
  ensureVapid();

  const sql = getDb();
  const subs = await sql<{ id: string; endpoint: string; p256dh: string; auth: string }[]>`
    SELECT id, endpoint, p256dh, auth FROM push_subscriptions
  `;

  if (subs.length === 0) return 0;

  const message = JSON.stringify(payload);
  let sent = 0;
  const toDelete: string[] = [];

  await Promise.all(
    subs.map(async (sub) => {
      const subscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      try {
        await webpush.sendNotification(subscription, message);
        sent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Endpoint is gone — mark for deletion
          toDelete.push(sub.id);
        } else {
          // Transient error — log but keep subscription
          console.warn(`[push] delivery failed for ${sub.endpoint.slice(0, 40)}…: ${(err as Error).message}`);
        }
      }
    })
  );

  // Prune expired subscriptions
  if (toDelete.length > 0) {
    await sql`DELETE FROM push_subscriptions WHERE id = ANY(${toDelete})`;
    console.log(`[push] pruned ${toDelete.length} expired subscription(s)`);
  }

  return sent;
}
