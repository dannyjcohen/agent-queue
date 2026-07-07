import { getDb } from '../../../lib/db';
import { validateBearer, validateCookie } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

// POST /api/waiting — PC pushes a new waiting item. Bearer auth only.
export async function POST(req: Request) {
  if (!validateBearer(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { thread_id, session_id, kind, context = {} } = body as {
    thread_id?: string;
    session_id?: string;
    kind?: string;
    context?: Record<string, unknown>;
  };

  if (!thread_id || typeof thread_id !== 'string' || !thread_id.trim()) {
    return Response.json({ error: 'thread_id is required' }, { status: 400 });
  }
  if (!session_id || typeof session_id !== 'string' || !session_id.trim()) {
    return Response.json({ error: 'session_id is required' }, { status: 400 });
  }
  if (!kind || !['permission', 'question', 'done'].includes(kind)) {
    return Response.json({ error: 'kind must be permission | question | done' }, { status: 400 });
  }

  const sql = getDb();
  const rows = await sql`
    INSERT INTO waiting_items (thread_id, session_id, kind, context)
    VALUES (${thread_id}, ${session_id}, ${kind}, ${JSON.stringify(context)})
    RETURNING id, thread_id, session_id, kind, context, status, created_at
  `;
  return Response.json(rows[0], { status: 201 });
}

// GET /api/waiting — phone lists open + recent items. Cookie auth only.
export async function GET(req: Request) {
  if (!await validateCookie(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = getDb();
  // Return: all 'waiting' items + items answered/expired in the last 24h
  const items = await sql`
    SELECT id, thread_id, session_id, kind, context, status, answer, created_at, answered_at
    FROM waiting_items
    WHERE status = 'waiting'
       OR (status IN ('answered', 'answered_locally', 'expired') AND created_at > NOW() - INTERVAL '24 hours')
    ORDER BY created_at DESC
    LIMIT 100
  `;
  return Response.json({ items });
}
