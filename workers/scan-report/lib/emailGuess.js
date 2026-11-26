// MPC-11111: POST /api/scan/guess, the receiving end of the "magic guess". Built SWITCHED OFF.
// A bot's bridge link carries a sealed token in its URL fragment (shared/email-guess.ts). The /scan page posts that token here; this opens it and answers with the
// address the person published in their own public bio, so the page can ask "is this your main email?". Nothing is stored, nothing is logged (no address,
// no token), the answer is never cached, and any token that does not open (wrong key, tampered, expired) gets the same quiet answer as no token: { guess: null }.
// 404 unless env.EMAIL_GUESS_ENABLED is the exact string "true" and the Worker secret EMAIL_GUESS_KEY is set (shared/email-guess.ts emailGuessOn).
import { emailGuessOn, openGuess } from '../../../shared/email-guess.ts';

const MAX_BODY_BYTES = 2048;

export async function handleEmailGuess(env, request, origin, json, { allowedOrigins, rateLimited }) {
  if (!emailGuessOn(env)) return new Response('Not found', { status: 404 });
  if (origin && !allowedOrigins.includes(origin)) return json({ error: 'Forbidden origin' }, 403);
  if (await rateLimited(env, request, 'email-guess:')) return json({ error: 'Too many requests' }, 429);
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413);
  let raw;
  try { raw = await request.text(); } catch { return json({ error: 'Bad request' }, 400); }
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Bad request' }, 400); }
  const g = await openGuess(env.EMAIL_GUESS_KEY, body?.token);
  const res = json({ guess: g ? { email: g.email, channel: g.channel, confidence: g.confidence, basis: g.basis } : null });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
