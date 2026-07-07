import bcrypt from 'bcryptjs';
import { checkRateLimit, issueSessionCookie } from '../../../../lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // Determine client IP from Vercel's forwarded header
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';

  const { allowed, retryAfterMs } = checkRateLimit(ip);
  if (!allowed) {
    return Response.json(
      { error: 'Too many attempts. Try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil(retryAfterMs / 1000)),
        },
      }
    );
  }

  let body: { password?: string } = {};
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { password } = body;
  if (!password || typeof password !== 'string') {
    return Response.json({ error: 'password is required' }, { status: 400 });
  }

  const storedHash = process.env.AUTH_PASSWORD_HASH;
  if (!storedHash) {
    return Response.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const valid = bcrypt.compareSync(password, storedHash);
  if (!valid) {
    return Response.json({ error: 'Invalid password' }, { status: 401 });
  }

  const cookie = await issueSessionCookie();
  return Response.json(
    { ok: true },
    {
      status: 200,
      headers: {
        'Set-Cookie': cookie,
      },
    }
  );
}
