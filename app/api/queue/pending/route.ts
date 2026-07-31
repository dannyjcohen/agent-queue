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
  // waking Neon on every tick. Fire-and-forget — a Redis error never blocks
  // the response or changes the returned items.
  if (items.length === 0) {
    clearDoorbell().catch(() => {});
  }

  return Response.json({ items });
}
