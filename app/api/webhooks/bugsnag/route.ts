// BUGSNAG_WEBHOOK_SECRET: 30e3f32f-0096-47fb-9d3c-683c0a3a8ce1
// Set this value as a Vercel environment variable named BUGSNAG_WEBHOOK_SECRET.
// Configure BugSnag webhook URL as:
//   https://agent-queue.vercel.app/api/webhooks/bugsnag?project=frontend
//   https://agent-queue.vercel.app/api/webhooks/bugsnag?project=backend
// Auth: either Authorization: Bearer <secret> header or ?secret=<secret> query param.

import { getDb } from '../../../../lib/db';

export const dynamic = 'force-dynamic';

// Only these trigger types result in a queue item being inserted.
// 'exception' is sent by BugSnag for handled errors and some notification rule configs.
const PROCESSED_TRIGGER_TYPES = new Set(['firstException', 'reoccurrence', 'exception']);

// Valid project types accepted via ?project= query param.
const VALID_PROJECT_TYPES = new Set(['frontend', 'backend']);

interface BugSnagStackFrame {
  file: string;
  method: string;
  lineNumber: number;
  columnNumber?: number;
  inProject?: boolean;
  code?: object;
}

interface BugSnagException {
  errorClass: string;
  message: string;
  stacktrace?: BugSnagStackFrame[];
}

interface BugSnagPayload {
  trigger?: { type?: string; message?: string };
  error?: {
    errorId?: string;
    exceptionClass?: string;
    message?: string;
    severity?: string;
    app?: { releaseStage?: string };
    url?: string;
    status?: string;
  };
  project?: { id?: string; name?: string; url?: string };
  exceptions?: BugSnagException[];
}

function formatStackTrace(frames: BugSnagStackFrame[] | undefined): string {
  if (!frames || frames.length === 0) return '';
  return frames
    .slice(0, 8)
    .map((f) => `${f.file}:${f.lineNumber} ${f.method}`)
    .join('\n');
}

export async function POST(req: Request): Promise<Response> {
  const tag = `[bugsnag-webhook ${new Date().toISOString()}]`;

  // --- Auth ---
  const secret = process.env.BUGSNAG_WEBHOOK_SECRET;
  if (!secret) {
    console.error(`${tag} BUGSNAG_WEBHOOK_SECRET not configured`);
    return Response.json({ error: 'BUGSNAG_WEBHOOK_SECRET is not configured' }, { status: 500 });
  }

  const url = new URL(req.url);
  const authHeader = req.headers.get('authorization');
  const secretParam = url.searchParams.get('secret');
  const projectParam = url.searchParams.get('project');

  console.log(`${tag} incoming POST — project=${projectParam} hasAuthHeader=${!!authHeader} hasSecretParam=${!!secretParam}`);

  const authorized =
    authHeader === `Bearer ${secret}` || secretParam === secret;

  if (!authorized) {
    console.warn(`${tag} auth failed — returning 200 to suppress BugSnag retries`);
    return Response.json({ error: 'Unauthorized' }, { status: 200 });
  }

  // --- ?project= param ---
  const projectType = url.searchParams.get('project');
  if (!projectType || !VALID_PROJECT_TYPES.has(projectType)) {
    console.warn(`${tag} invalid/missing project param: ${projectType}`);
    return Response.json({ error: 'missing or invalid project param' }, { status: 200 });
  }

  // --- Parse body ---
  let body: BugSnagPayload = {};
  try {
    body = await req.json();
  } catch (err) {
    console.error(`${tag} JSON parse failed:`, err);
    return Response.json({ error: 'invalid JSON body' }, { status: 200 });
  }

  const { trigger, error, project, exceptions } = body;

  // --- Trigger filtering ---
  const triggerType = trigger?.type ?? '(missing)';
  console.log(`${tag} trigger=${triggerType} errorClass=${error?.exceptionClass ?? '(none)'} errorId=${error?.errorId ?? '(none)'} releaseStage=${error?.app?.releaseStage ?? '(none)'}`);

  if (!PROCESSED_TRIGGER_TYPES.has(triggerType)) {
    console.log(`${tag} skipping — trigger type not in processed set`);
    return Response.json({ skipped: true, trigger: triggerType }, { status: 200 });
  }

  // --- Build stack trace string ---
  const firstException = Array.isArray(exceptions) ? exceptions[0] : undefined;
  const stackTrace = formatStackTrace(firstException?.stacktrace);

  // --- Build queue payload ---
  const payload = {
    project_type: projectType,
    error_group_id: error?.errorId ?? null,
    error_class: error?.exceptionClass ?? null,
    message: error?.message ?? null,
    severity: error?.severity ?? null,
    release_stage: error?.app?.releaseStage ?? null,
    trigger_type: triggerType,
    bugsnag_url: error?.url ?? null,
    bugsnag_project_name: project?.name ?? null,
    stack_trace: stackTrace || null,
  };

  // --- Insert into queue ---
  try {
    const sql = getDb();
    const rows = await sql`
      INSERT INTO queue_items (type, source, payload)
      VALUES (${'bugsnag-alert'}, ${'bugsnag'}, ${JSON.stringify(payload)})
      RETURNING id, type, source, status, created_at
    `;
    console.log(`${tag} queued — id=${rows[0].id} errorId=${payload.error_group_id}`);
    return Response.json({ queued: true, id: rows[0].id }, { status: 201 });
  } catch (err) {
    console.error(`${tag} DB insert failed:`, err);
    return Response.json({ error: 'queue insert failed' }, { status: 500 });
  }
}
