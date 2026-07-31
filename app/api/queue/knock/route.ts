/**
 * GET /api/queue/knock
 *
 * Lightweight doorbell check — reads ONLY the Upstash Redis flag.
 * Never touches Neon/Postgres.
 *
 * Response:
 *   { pending: true }              — flag is set; caller should poll /pending
 *   { pending: false }             — flag absent; nothing queued
 *   { pending: true, degraded: true } — Redis creds missing; caller falls through
 *                                       to a real /pending check
 *
 * Auth: same Bearer token as all other queue endpoints.
 */

import { validateBearer } from '../../../../lib/auth';
import { isDoorbellPending } from '../../../../lib/doorbell';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!validateBearer(req)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pending = await isDoorbellPending();

  if (pending === null) {
    // Redis creds absent or transient error — degrade gracefully
    return Response.json({ pending: true, degraded: true });
  }

  return Response.json({ pending });
}
