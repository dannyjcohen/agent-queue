/**
 * Upstash Redis doorbell — a lightweight flag layer in front of Neon.
 *
 * When a queue item is enqueued, SET queue:has-pending = 1 (with TTL).
 * When /api/queue/pending returns zero items, DEL the flag.
 * GET /api/queue/knock reads ONLY this flag — never touches Postgres.
 *
 * If Redis creds are absent, all operations degrade gracefully:
 *   - setDoorbell / clearDoorbell: no-ops (silent)
 *   - isDoorbelllPending: returns null (caller treats as "degraded")
 *
 * Uses Upstash's plain HTTP REST API — no SDK needed.
 *
 * Env vars:
 *   UPSTASH_REDIS_REST_URL   — e.g. https://xxxxxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN — Upstash REST token
 */

const KEY = 'queue:has-pending';
const TTL_SECONDS = 6 * 60 * 60; // 6h — self-heals a missed DEL

function getConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ''), token };
}

async function redisCommand(cmd: unknown[]): Promise<unknown> {
  const cfg = getConfig();
  if (!cfg) return null;
  const res = await fetch(`${cfg.url}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmd),
    // 5-second hard timeout — doorbell ops must never block the main request path
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`Upstash returned HTTP ${res.status}`);
  }
  const data = (await res.json()) as { result: unknown };
  return data.result;
}

/**
 * SET queue:has-pending = 1 EX <ttl>.
 * Called after a successful enqueue.
 * Fire-and-forget safe — errors are caught and logged.
 */
export async function setDoorbell(): Promise<void> {
  if (!getConfig()) return; // degrade gracefully
  try {
    await redisCommand(['SET', KEY, '1', 'EX', TTL_SECONDS]);
  } catch (err) {
    console.warn('[doorbell] setDoorbell failed:', (err as Error).message);
  }
}

/**
 * DEL queue:has-pending.
 * Called when /api/queue/pending returns 0 items.
 * Fire-and-forget safe — errors are caught and logged.
 */
export async function clearDoorbell(): Promise<void> {
  if (!getConfig()) return; // degrade gracefully
  try {
    await redisCommand(['DEL', KEY]);
  } catch (err) {
    console.warn('[doorbell] clearDoorbell failed:', (err as Error).message);
  }
}

/**
 * GET queue:has-pending.
 * Returns:
 *   true  — flag is set (poll /pending)
 *   false — flag is absent (skip Neon)
 *   null  — Redis creds missing (caller should degrade)
 */
export async function isDoorbellPending(): Promise<boolean | null> {
  if (!getConfig()) return null; // degrade gracefully
  try {
    const result = await redisCommand(['GET', KEY]);
    return result === '1';
  } catch (err) {
    console.warn('[doorbell] isDoorbellPending failed:', (err as Error).message);
    return null; // degrade on error — caller falls through to Neon
  }
}
