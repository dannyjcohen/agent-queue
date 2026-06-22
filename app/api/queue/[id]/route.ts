import { getDb } from '../../../../lib/db';
import { validateAuth } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  if (!validateAuth(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const { status, error = null } = body as { status?: string; error?: string };
  const validStatuses = ['processing', 'done', 'failed'];
  if (!status || !validStatuses.includes(status)) {
    return Response.json({ error: 'status must be processing, done, or failed' }, { status: 400 });
  }

  const sql = getDb();
  const setProcessedAt = status === 'done' || status === 'failed';
  const rows = setProcessedAt
    ? await sql`
        UPDATE queue_items
        SET status = ${status}, error = ${error as string}, processed_at = NOW()
        WHERE id = ${params.id}
        RETURNING id, status, processed_at
      `
    : await sql`
        UPDATE queue_items
        SET status = ${status}, error = ${error as string}
        WHERE id = ${params.id}
        RETURNING id, status, processed_at
      `;

  if (rows.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  return Response.json(rows[0]);
}
