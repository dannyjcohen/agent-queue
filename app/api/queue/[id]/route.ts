import { getDb } from '../../../../lib/db';
import { validateAuth } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await validateAuth(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const { status, error = null, result = null } = body as {
    status?: string;
    error?: string | null;
    result?: unknown | null;
  };

  const validStatuses = ['processing', 'done', 'failed'];
  const hasValidStatus = !!status && validStatuses.includes(status);
  const hasResult = result !== null && result !== undefined;

  if (!hasValidStatus && !hasResult) {
    return Response.json(
      { error: 'provide status (processing|done|failed) and/or result' },
      { status: 400 }
    );
  }

  const sql = getDb();
  const setProcessedAt = hasValidStatus && (status === 'done' || status === 'failed');
  const resultJson = hasResult ? JSON.stringify(result) : null;

  let rows;
  if (hasValidStatus && hasResult) {
    if (setProcessedAt) {
      rows = await sql`
        UPDATE queue_items
        SET status = ${status as string},
            error = ${error as string},
            processed_at = NOW(),
            result = ${resultJson}::jsonb
        WHERE id = ${id}::uuid
        RETURNING id, status, processed_at, error, result
      `;
    } else {
      rows = await sql`
        UPDATE queue_items
        SET status = ${status as string},
            error = ${error as string},
            result = ${resultJson}::jsonb
        WHERE id = ${id}::uuid
        RETURNING id, status, processed_at, error, result
      `;
    }
  } else if (hasValidStatus) {
    if (setProcessedAt) {
      rows = await sql`
        UPDATE queue_items
        SET status = ${status as string},
            error = ${error as string},
            processed_at = NOW()
        WHERE id = ${id}::uuid
        RETURNING id, status, processed_at, error, result
      `;
    } else {
      rows = await sql`
        UPDATE queue_items
        SET status = ${status as string},
            error = ${error as string}
        WHERE id = ${id}::uuid
        RETURNING id, status, processed_at, error, result
      `;
    }
  } else {
    // hasResult only, no status change
    rows = await sql`
      UPDATE queue_items
      SET result = ${resultJson}::jsonb
      WHERE id = ${id}::uuid
      RETURNING id, status, processed_at, error, result
    `;
  }

  if (rows.length === 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  return Response.json(rows[0]);
}
