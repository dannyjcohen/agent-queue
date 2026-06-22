import { sql } from '../../../lib/db';
import { validateAuth } from '../../../lib/auth';

export async function POST(req: Request) {
  if (!validateAuth(req)) {
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

  const rows = await sql`
    INSERT INTO queue_items (type, source, payload)
    VALUES (${type}, ${source as string}, ${JSON.stringify(payload)})
    RETURNING id, type, source, status, created_at
  `;
  return Response.json(rows[0], { status: 201 });
}
