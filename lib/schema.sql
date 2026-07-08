CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS queue_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'unknown',
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','done','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  error TEXT,
  result JSONB
);
CREATE INDEX IF NOT EXISTS idx_queue_items_status ON queue_items(status, created_at);

-- Remote waiting-terminal queue (task 387)
-- PC pushes items here when Claude is waiting on Danny; phone surfaces and answers them.
CREATE TABLE IF NOT EXISTS waiting_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id TEXT NOT NULL,          -- stable identifier across claude --resume forks
  session_id TEXT NOT NULL,         -- current Claude session id in this thread
  kind TEXT NOT NULL CHECK (kind IN ('permission', 'question', 'done')),
  context JSONB NOT NULL DEFAULT '{}', -- tool name + input (permission) or question text + agent/project/cwd
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'answered', 'answered_locally', 'expired')),
  answer JSONB,                     -- permission decision (allow/deny) or free-text reply
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_waiting_items_status ON waiting_items(status, created_at);
CREATE INDEX IF NOT EXISTS idx_waiting_items_thread ON waiting_items(thread_id, created_at);

-- Away state sync (task 430)
-- Single-row table. The dashboard PC pushes current away boolean + heartbeat here.
-- The phone reads it to show the current state and detect PC unreachable (heartbeat stale >3 min).
CREATE TABLE IF NOT EXISTS away_state (
  id               INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  away             BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Away toggle requests (task 430)
-- Single-row table. Phone posts desired away state here; PC polls, applies, deletes.
CREATE TABLE IF NOT EXISTS away_requests (
  id           INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  away         BOOLEAN NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Web push subscriptions (task 389)
-- One row per browser subscription endpoint. Pruned automatically on 404/410 from the push service.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  expiration_time BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
