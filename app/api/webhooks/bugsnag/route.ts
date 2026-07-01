// BUGSNAG_WEBHOOK_SECRET: 30e3f32f-0096-47fb-9d3c-683c0a3a8ce1
// Set this value as a Vercel environment variable named BUGSNAG_WEBHOOK_SECRET.
// Configure BugSnag webhook URL as:
//   https://agent-queue.vercel.app/api/webhooks/bugsnag?project=frontend
//   https://agent-queue.vercel.app/api/webhooks/bugsnag?project=backend
// Auth: either Authorization: Bearer <secret> header or ?secret=<secret> query param.

import { getDb } from '../../../../lib/db';

export const dynamic = 'force-dynamic';

// Only these trigger types result in a queue item being inserted.
const PROCESSED_TRIGGER_TYPES = new Set(['firstException', 'reoccurrence']);

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
  // --- Auth ---
  const secret = process.env.BUGSNAG_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json({ error: 'BUGSNAG_WEBHOOK_SECRET is not configured' }, { status: 500 });
  }

  const url = new URL(req.url);
  const authHeader = req.headers.get('authorization');
  const secretParam = url.searchParams.get('secret');

  const authorized =
    authHeader === `Bearer ${secret}` || secretParam === secret;

  if (!authorized) {
    // Return 200 to prevent BugSnag retries on auth failures (misconfiguration).
    return Response.json({ error: 'Unauthorized' }, { status: 200 });
  }

  // --- ?project= param ---
  const projectType = url.searchParams.get('project');
  if (!projectType || !VALID_PROJECT_TYPES.has(projectType)) {
    // Missing or invalid config — return 200 so BugSnag does not retry endlessly.
    return Response.json({ error: 'missing or invalid project param' }, { status: 200 });
  }

  // --- Parse body ---
  let body: BugSnagPayload = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 200 });
  }

  const { trigger, error, project, exceptions } = body;

  // --- Trigger filtering ---
  const triggerType = trigger?.type ?? '';
  if (!PROCESSED_TRIGGER_TYPES.has(triggerType)) {
    return Response.json({ skipped: true }, { status: 200 });
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
  const sql = getDb();
  const rows = await sql`
    INSERT INTO queue_items (type, source, payload)
    VALUES (${'bugsnag-alert'}, ${'bugsnag'}, ${JSON.stringify(payload)})
    RETURNING id, type, source, status, created_at
  `;

  return Response.json({ queued: true, id: rows[0].id }, { status: 201 });
}
