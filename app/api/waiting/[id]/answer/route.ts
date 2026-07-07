import { getDb } from '../../../../../lib/db';
import { validateCookie } from '../../../../../lib/auth';

export const dynamic = 'force-dynamic';

// POST /api/waiting/:id/answer — phone submits Danny's answer. Cookie auth only.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await validateCookie(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { answer } = body as { answer?: unknown };
  if (answer === undefined || answer === null) {
    return Response.json({ error: 'answer is required' }, { status: 400 });
  }

  const sql = getDb();
  // Only allow answering items that are still waiting
  const rows = await sql`
    UPDATE waiting_items
    SET status = 'answered',
        answer = ${JSON.stringify(answer)}::jsonb,
        answered_at = NOW()
    WHERE id = ${id}::uuid
      AND status = 'waiting'
    RETURNING id, thread_id, session_id, kind, status, answer, answered_at
  `;
  if (rows.length === 0) {
    // Could be 404 or already answered — check which
    const check = await sql`SELECT status FROM waiting_items WHERE id = ${id}::uuid`;
    if (check.length === 0) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    return Response.json(
      { error: `Item is already ${check[0].status}` },
      { status: 409 }
    );
  }
  return Response.json(rows[0]);
}
