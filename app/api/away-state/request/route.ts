import { getDb } from '../../../../lib/db';
import { validateBearer, validateCookie } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// GET /api/away-state/request
// Bearer auth (PC polls for pending requests).
// Returns { request: { away: boolean, requested_at: string } | null }
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
  if (!validateBearer(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = getDb();
  const rows = await sql`
    SELECT away, requested_at FROM away_requests WHERE id = 1
  `;

  return Response.json({
    request: rows.length > 0 ? { away: rows[0].away, requested_at: rows[0].requested_at } : null,
  });
}

// ---------------------------------------------------------------------------
// POST /api/away-state/request
// Cookie auth (phone submits desired toggle).
// Body: { away: true | false }
// Upserts the single-row request table. Phone can only flip between Here/Away.
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  if (!(await validateCookie(req))) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { away } = body as { away?: unknown };
  if (typeof away !== 'boolean') {
    return Response.json({ error: 'away must be true or false' }, { status: 400 });
  }

  const sql = getDb();
  await sql`
    INSERT INTO away_requests (id, away, requested_at)
    VALUES (1, ${away}, NOW())
    ON CONFLICT (id) DO UPDATE SET
      away = EXCLUDED.away,
      requested_at = NOW()
  `;

  return Response.json({ ok: true, away, status: 'pending' });
}

// ---------------------------------------------------------------------------
// DELETE /api/away-state/request
// Bearer auth (PC clears the request after applying it).
// ---------------------------------------------------------------------------
export async function DELETE(req: Request) {
  if (!validateBearer(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sql = getDb();
  await sql`DELETE FROM away_requests WHERE id = 1`;

  return Response.json({ ok: true });
}
