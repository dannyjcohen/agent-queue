import { getDb } from '../../../lib/db';
import { validateBearer, validateCookie } from '../../../lib/auth';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/away-state
// Cookie auth (phone browser). Returns current away state + heartbeat time.
// Response: { away: boolean, updated_at: string, last_heartbeat_at: string, pending_request: boolean }
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  if (!(await validateCookie(req))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = getDb();

  // Fetch away_state row (always exists after migration seeds it)
  const stateRows = await sql`
    SELECT away, updated_at, last_heartbeat_at
    FROM away_state
    WHERE id = 1
  `;

  // Fetch pending request row if any
  const reqRows = await sql`
    SELECT away, requested_at FROM away_requests WHERE id = 1
  `;

  const state = stateRows[0] ?? { away: false, updated_at: new Date().toISOString(), last_heartbeat_at: new Date().toISOString() };
  const pendingRequest = reqRows.length > 0 ? reqRows[0] : null;

  return Response.json({
    away: state.away,
    updated_at: state.updated_at,
    last_heartbeat_at: state.last_heartbeat_at,
    pending_request: pendingRequest !== null ? { away: pendingRequest.away, requested_at: pendingRequest.requested_at } : null,
  });
}

// ---------------------------------------------------------------------------
// PUT /api/away-state
// Bearer auth only (PC pushes current state + heartbeat).
// Body: { away: boolean, updated_at: string }
// Updates the single-row table. Always succeeds (upsert).
// ---------------------------------------------------------------------------
export async function PUT(req: Request) {
  if (!validateBearer(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { away, updated_at } = body as { away?: unknown; updated_at?: unknown };

  if (typeof away !== 'boolean') {
    return Response.json({ error: 'away must be boolean' }, { status: 400 });
  }

  const updatedAt = typeof updated_at === 'string' ? updated_at : new Date().toISOString();

  const sql = getDb();
  await sql`
    INSERT INTO away_state (id, away, updated_at, last_heartbeat_at)
    VALUES (1, ${away}, ${updatedAt}::timestamptz, NOW())
    ON CONFLICT (id) DO UPDATE SET
      away = EXCLUDED.away,
      updated_at = EXCLUDED.updated_at,
      last_heartbeat_at = NOW()
  `;

  return Response.json({ ok: true });
}
