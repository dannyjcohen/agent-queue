import { sql } from '../../../../lib/db';
import { validateAuth } from '../../../../lib/auth';

export async function GET(req: Request) {
  if (!validateAuth(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const items = await sql`
    SELECT * FROM queue_items
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT 50
  `;
  return Response.json({ items });
}
