// One-off migration: create away_state and away_requests tables in Neon (task 430).
// Run once: node scripts/migrate-away-state.js
//
// Loads DATABASE_URL from the Vercel env or from a local .env.local file.
// Follows the no-dotenv pattern used by other scripts in this repo.

'use strict';

const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, 'utf8');
  const env = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const repoRoot = path.resolve(__dirname, '..');
const envLocal = loadEnvFile(path.join(repoRoot, '.env.local'));

const DATABASE_URL = process.env.DATABASE_URL || envLocal.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set (checked process.env and .env.local)');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  // away_state: single-row table. The dashboard PC pushes the current away
  // boolean here every ~60s and on every change. id=1 is the only row.
  await sql`
    CREATE TABLE IF NOT EXISTS away_state (
      id               INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      away             BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  // Seed the single row so GET never returns 404 after first deploy.
  await sql`
    INSERT INTO away_state (id, away, updated_at, last_heartbeat_at)
    VALUES (1, FALSE, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
  `;

  // away_requests: phone submits a desired away state here; the dashboard
  // polls for it, applies it, then clears the row.
  await sql`
    CREATE TABLE IF NOT EXISTS away_requests (
      id           INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      away         BOOLEAN NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log('away_state and away_requests tables created (or already existed).');
  console.log('away_state seeded with row id=1 away=false.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
