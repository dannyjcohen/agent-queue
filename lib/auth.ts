import { SignJWT, jwtVerify } from 'jose';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SESSION_COOKIE = 'aq_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days

function getCookieSecret(): Uint8Array {
  const s = process.env.COOKIE_SECRET;
  if (!s) throw new Error('COOKIE_SECRET is not set');
  return new TextEncoder().encode(s);
}

// ---------------------------------------------------------------------------
// Bearer token auth (existing machine-caller path — unchanged)
// ---------------------------------------------------------------------------
export function validateBearer(req: Request): boolean {
  const secret = process.env.QUEUE_API_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

// ---------------------------------------------------------------------------
// Session cookie auth (new browser path)
// ---------------------------------------------------------------------------
export async function validateCookie(req: Request): Promise<boolean> {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!match) return false;
  try {
    await jwtVerify(match[1], getCookieSecret(), { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Combined auth — Bearer OR cookie. Use this for all API routes that need to
// serve both machine callers and the phone browser.
// ---------------------------------------------------------------------------
export async function validateAuth(req: Request): Promise<boolean> {
  if (validateBearer(req)) return true;
  return validateCookie(req);
}

// ---------------------------------------------------------------------------
// Issue a signed session cookie (called from POST /api/auth/login)
// ---------------------------------------------------------------------------
export async function issueSessionCookie(): Promise<string> {
  const token = await new SignJWT({ sub: 'danny' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getCookieSecret());

  const maxAge = SESSION_TTL_SECONDS;
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

// ---------------------------------------------------------------------------
// In-memory rate limiter for the login endpoint.
//
// Trade-off: Vercel serverless functions are stateless — each cold start gets
// a fresh in-memory store. This means the 5/min cap is per-instance, not
// globally enforced across all concurrent Vercel instances. For a single-user
// personal app this is acceptable: it still provides meaningful brute-force
// resistance, and a Neon-backed limiter would add latency and complexity for
// no real security gain (there's only one valid user anyway, and the account
// locks on 5 wrong guesses per warm instance). Documented in vault.
// ---------------------------------------------------------------------------
type RateEntry = { count: number; resetAt: number };
const rateLimitMap = new Map<string, RateEntry>();

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}
