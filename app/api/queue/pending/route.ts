import { getDb } from '../../../../lib/db';
import { validateAuth } from '../../../../lib/auth';
import { clearDoorbell } from '../../../../lib/doorbell';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!await validateAuth(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sql = getDb();
  const items = await sql`
    SELECT * FROM queue_items
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 50
  `;

  // When the queue is empty, clear the doorbell flag so the poller stops
  // waking Neon on every tick. MUST be awaited: on Vercel serverless,
  // un-awaited work after the response is frequently dropped, leaving the
  // flag stuck at 1 (observed in smoke-test step E, 2026-08-01) — which
  // makes every 30s knock wake Neon until a DEL finally lands. clearDoorbell
  // never throws (internal try/catch) and is bounded by a 5s timeout.
  if (items.length === 0) {
    await clearDoorbell();
  }

  return Response.json({ items });
}
