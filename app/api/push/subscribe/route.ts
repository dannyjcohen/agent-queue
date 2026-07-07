import { getDb } from '../../../../lib/db';
import { validateCookie } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

// POST /api/push/subscribe
// Stores (or upserts) a browser push subscription tied to a specific endpoint.
// Cookie auth only — this is a browser-only action.
export async function POST(req: Request) {
  if (!await validateCookie(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let sub: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    expirationTime?: number | null;
  };

  try {
    sub = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { endpoint, keys } = sub;
  if (!endpoint || typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
    return Response.json({ error: 'endpoint is required and must be an https URL' }, { status: 400 });
  }
  if (!keys?.p256dh || !keys?.auth) {
    return Response.json({ error: 'keys.p256dh and keys.auth are required' }, { status: 400 });
  }

  const sql = getDb();
  const rows = await sql`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, expiration_time)
    VALUES (
      ${endpoint},
      ${keys.p256dh},
      ${keys.auth},
      ${sub.expirationTime ?? null}
    )
    ON CONFLICT (endpoint) DO UPDATE SET
      p256dh          = EXCLUDED.p256dh,
      auth            = EXCLUDED.auth,
      expiration_time = EXCLUDED.expiration_time,
      updated_at      = NOW()
    RETURNING id, endpoint, created_at, updated_at
  `;

  return Response.json(rows[0], { status: rows[0]?.updated_at === rows[0]?.created_at ? 201 : 200 });
}
