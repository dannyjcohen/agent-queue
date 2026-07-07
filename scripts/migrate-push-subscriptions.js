// One-off migration: create push_subscriptions table in Neon.
// Run once: node scripts/migrate-push-subscriptions.js
//
// Loads DATABASE_URL from the Vercel env or from a local .env.local file.
// Follows the no-dotenv pattern used by other scripts in this repo.

'use strict';

const fs = require('fs');
const path = require('path');
const { neon } = require('@neondatabase/serverless');

// Minimal .env parser — no external dep required
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

// Look for .env.local in the repo root
const repoRoot = path.resolve(__dirname, '..');
const envLocal = loadEnvFile(path.join(repoRoot, '.env.local'));

const DATABASE_URL = process.env.DATABASE_URL || envLocal.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set (checked process.env and .env.local)');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      endpoint        TEXT NOT NULL UNIQUE,
      p256dh          TEXT NOT NULL,
      auth            TEXT NOT NULL,
      expiration_time BIGINT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  console.log('push_subscriptions table created (or already existed).');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
