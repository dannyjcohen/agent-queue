import { getDb } from '../../../lib/db';
import { validateAuth } from '../../../lib/auth';
import { setDoorbell } from '../../../lib/doorbell';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (!await validateAuth(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }

  const { type, source = 'unknown', payload = {} } = body as {
    type?: string; source?: string; payload?: Record<string, unknown>;
  };

  if (!type || typeof type !== 'string' || !type.trim()) {
    return Response.json({ error: 'type is required' }, { status: 400 });
  }

  const sql = getDb();
  const rows = await sql`
    INSERT INTO queue_items (type, source, payload)
    VALUES (${type}, ${source as string}, ${JSON.stringify(payload)})
    RETURNING id, type, source, status, created_at
  `;

  // SET the doorbell flag so the local poller knows to check /pending.
  // MUST be awaited: on Vercel serverless, un-awaited work after the
  // response is frequently dropped — a dropped SET means the enqueued item
  // waits up to 30 min for the full-check fallback instead of ≤30s.
  // setDoorbell never throws (internal try/catch), bounded by a 5s timeout.
  await setDoorbell();

  return Response.json(rows[0], { status: 201 });
}
