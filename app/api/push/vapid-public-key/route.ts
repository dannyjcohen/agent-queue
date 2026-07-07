export const dynamic = 'force-dynamic';

// GET /api/push/vapid-public-key
// Returns the VAPID public key for the browser to use when subscribing.
// No auth required — the public key is intentionally public.
export async function GET() {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) {
    return Response.json({ error: 'VAPID not configured' }, { status: 503 });
  }
  return Response.json({ publicKey: key });
}
