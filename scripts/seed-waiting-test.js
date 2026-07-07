// Throwaway seed script — seeds waiting items for UI testing.
// Loads QUEUE_API_SECRET from dashboard/.env at runtime (no dotenv dep needed).
// Usage:
//   node scripts/seed-waiting-test.js          # seed 3 test items
//   node scripts/seed-waiting-test.js --clean  # expire all seeded items
//
// NEVER prints or echoes secrets.

'use strict';

const path = require('path');
const fs = require('fs');

// Resolve dashboard/.env — it lives in the agent-system repo on the local machine.
// Try a few candidate paths (Windows and Unix-style) in order.
const candidateEnvPaths = [
  path.resolve('C:/dev/agent-system/dashboard/.env'),
  path.resolve('/c/dev/agent-system/dashboard/.env'),
  path.resolve(__dirname, '../../../../dev/agent-system/dashboard/.env'),
];
const envPath = candidateEnvPaths.find(p => {
  try { fs.accessSync(p); return true; } catch { return false; }
});
if (!envPath) {
  console.error('Could not find dashboard/.env. Tried:', candidateEnvPaths.join(', '));
  process.exit(1);
}

// Minimal .env parser — no external dep
function loadEnv(filePath) {
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

const env = loadEnv(envPath);
const secret = env.QUEUE_API_SECRET;
if (!secret) {
  console.error('QUEUE_API_SECRET not found in', envPath);
  process.exit(1);
}

const BASE = 'https://agent-queue.vercel.app';

async function post(urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST ${urlPath} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function patchItem(id, body) {
  const res = await fetch(`${BASE}/api/waiting/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH ${id} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function getWaiting() {
  const res = await fetch(`${BASE}/api/waiting`, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  if (!res.ok) throw new Error(`GET /api/waiting → ${res.status}`);
  return res.json();
}

const SEED_THREAD_1 = 'seed-thread-aaa-111';
const SEED_THREAD_2 = 'seed-thread-bbb-222';

async function seed() {
  console.log('Seeding waiting items...');

  // Thread 1: permission item
  const p1 = await post('/api/waiting', {
    thread_id: SEED_THREAD_1,
    session_id: 'seed-session-test-001',
    kind: 'permission',
    context: {
      tool_name: 'Bash',
      tool_input: 'git push origin feature/my-branch',
      agent_name: 'fern',
      project: 'agent-queue',
      cwd: '/c/xampp/htdocs/dc-projects/agent-queue',
    },
  });
  console.log('Created permission item:', p1.id);

  // Thread 1: question item (same thread)
  const q1 = await post('/api/waiting', {
    thread_id: SEED_THREAD_1,
    session_id: 'seed-session-test-001',
    kind: 'question',
    context: {
      message: "I've found two approaches for the schema migration. Option A: add a nullable column and backfill. Option B: create a new table and join. Which do you prefer?",
      agent_name: 'boris',
      project: 'agent-queue',
    },
  });
  console.log('Created question item:', q1.id);

  // Thread 2: done item (different thread)
  const d1 = await post('/api/waiting', {
    thread_id: SEED_THREAD_2,
    session_id: 'seed-session-test-002',
    kind: 'done',
    context: {
      summary: 'Task 387 is complete. The waiting_items schema is deployed and all 5 API endpoints are verified against the live Neon database. Activity log updated in vault.',
      agent_name: 'boris',
      project: 'agent-queue',
    },
  });
  console.log('Created done item:', d1.id);

  console.log('\nSeeded 3 items across 2 threads.');
  console.log('View at: https://agent-queue.vercel.app/waiting');
  return [p1.id, q1.id, d1.id];
}

async function cleanAll() {
  console.log('Cleaning up seeded items...');
  const data = await getWaiting();
  const seedItems = (data.items || []).filter(
    i => i.thread_id === SEED_THREAD_1 || i.thread_id === SEED_THREAD_2
  );
  if (seedItems.length === 0) {
    console.log('No seed items found to clean.');
    return;
  }
  for (const item of seedItems) {
    try {
      await patchItem(item.id, { status: 'expired' });
      console.log('Expired:', item.id);
    } catch (e) {
      console.log('Could not expire', item.id, '-', e.message);
    }
  }
}

const doClean = process.argv.includes('--clean');

(doClean ? cleanAll() : seed()).catch(err => {
  console.error(err.message);
  process.exit(1);
});
