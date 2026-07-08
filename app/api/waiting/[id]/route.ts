import { getDb } from '../../../../lib/db';
import { validateBearer } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/waiting/:id — hook/dispatcher polls for an answer. Bearer auth only.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateBearer(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const sql = getDb();
  const rows = await sql`
    SELECT id, thread_id, session_id, kind, context, status, answer, created_at, answered_at
    FROM waiting_items
    WHERE id = ${id}::uuid
  `;
  if (rows.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  return Response.json(rows[0]);
}

// PATCH /api/waiting/:id — PC marks answered_locally or expired. Bearer auth only.
// Body: { status: "answered_locally" | "expired", reason?: "timeout" }
// When status="expired" and reason="timeout", stores answer={expired_reason:"timeout"}.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateBearer(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { status, reason } = body as { status?: string; reason?: string };
  const validStatuses = ['answered_locally', 'expired'];
  if (!status || !validStatuses.includes(status)) {
    return Response.json(
      { error: 'status must be answered_locally | expired' },
      { status: 400 }
    );
  }

  const sql = getDb();

  // When expiring due to timeout, store the reason in the answer column
  // so the UI can show "Timed out" instead of generic "expired".
  const isTimeoutExpiry = status === 'expired' && reason === 'timeout';

  let rows;
  if (isTimeoutExpiry) {
    rows = await sql`
      UPDATE waiting_items
      SET status = ${status},
          answer = '{"expired_reason":"timeout"}'::jsonb,
          answered_at = NOW()
      WHERE id = ${id}::uuid
      RETURNING id, thread_id, session_id, kind, status, answer, answered_at
    `;
  } else {
    rows = await sql`
      UPDATE waiting_items
      SET status = ${status},
          answered_at = NOW()
      WHERE id = ${id}::uuid
      RETURNING id, thread_id, session_id, kind, status, answer, answered_at
    `;
  }

  if (rows.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  return Response.json(rows[0]);
}
