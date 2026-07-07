import { getDb } from '../../../lib/db';
import { validateBearer, validateCookie, validateAuth } from '../../../lib/auth';
import { sendPushToAll } from '../../../lib/push';

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

  const { thread_id, session_id, kind, context = {}, notify = false } = body as {
    thread_id?: string;
    session_id?: string;
    kind?: string;
    context?: Record<string, unknown>;
    notify?: boolean;
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
  const item = rows[0];

  // Fire web push if requested. Wrapped in try/catch so a push failure never
  // breaks item creation — the item is already in the DB at this point.
  if (notify) {
    try {
      const pushPayload = buildPushPayload(kind as string, context as Record<string, unknown>);
      await sendPushToAll(pushPayload);
    } catch (err) {
      // Log but do not surface to caller
      console.warn('[waiting POST] push send failed:', (err as Error).message);
    }
  }

  return Response.json(item, { status: 201 });
}

// ---------------------------------------------------------------------------
// Build a notification payload from the waiting item.
// Title/body summarize the item. No full tool inputs in the body (can be large).
// ---------------------------------------------------------------------------
function buildPushPayload(kind: string, context: Record<string, unknown>) {
  const agent = typeof context.agent_name === 'string' ? context.agent_name : null;
  const project = typeof context.project === 'string' ? context.project : null;

  let title = 'Agent Queue — action needed';
  let body = 'Claude is waiting for your input.';

  if (kind === 'permission') {
    const tool = typeof context.tool_name === 'string' ? context.tool_name : 'a tool';
    title = 'Permission request';
    const parts: string[] = [`${tool} call`];
    if (agent) parts.push(`from ${agent}`);
    if (project) parts.push(`on ${project}`);
    body = parts.join(' ');
  } else if (kind === 'question') {
    title = 'Question from Claude';
    const msg =
      typeof context.message === 'string' ? context.message :
      typeof context.question === 'string' ? context.question : null;
    if (msg) {
      // First 120 chars, no newlines
      body = msg.replace(/\n+/g, ' ').slice(0, 120) + (msg.length > 120 ? '…' : '');
    } else if (agent) {
      body = `${agent} has a question`;
    }
  } else if (kind === 'done') {
    title = 'Task complete';
    const summary = typeof context.summary === 'string' ? context.summary : null;
    if (summary) {
      body = summary.replace(/\n+/g, ' ').slice(0, 120) + (summary.length > 120 ? '…' : '');
    } else if (agent) {
      body = `${agent} finished`;
    }
  }

  return { title, body, url: '/waiting', tag: 'agent-queue-waiting' };
}

// GET /api/waiting — phone lists open + recent items. Cookie or Bearer auth.
// Bearer is accepted so the local answer-dispatcher can poll for answered items.
// Server-side auto-expiry: permission items older than 6 minutes are expired here
// before the SELECT, so stale Allow/Deny buttons never surface on the phone.
export async function GET(req: Request) {
  if (!await validateAuth(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = getDb();

  // Auto-expire stale permission items before fetching.
  // Only affects kind=permission, status=waiting, created > 6 minutes ago.
  // question/done items are not touched — they have no answering deadline.
  await sql`
    UPDATE waiting_items
    SET status = 'expired', answered_at = NOW()
    WHERE kind = 'permission'
      AND status = 'waiting'
      AND created_at < NOW() - INTERVAL '6 minutes'
  `;

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
