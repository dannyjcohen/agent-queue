export function validateAuth(req: Request): boolean {
  const secret = process.env.QUEUE_API_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}
