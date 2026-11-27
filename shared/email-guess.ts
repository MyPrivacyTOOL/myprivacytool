// MPC-11111 (Chris, 2026-11-24: "build it"): the "magic guess". Built SWITCHED OFF.
//
// What it is (Notion "Channel OSINT Workflow Strategy", Step 3): a person arrives on the web scan from a bot's bridge link. If we are at least 80 percent
// sure of their main email we say "we think your main email is ...", and they tap YES or type the right one. Below 80 percent we say nothing and the page
// asks for the email as it always did. Never guess blindly.
//
// Where a guess may come from, and the only place it comes from today: an email address the person PUBLISHED in their own public bio on the channel they
// just wrote to us from (the X Mirror already reads that bio, with their consent). Exactly one address in the bio = we are 90 percent sure it is theirs
// (they wrote it there). None, or two different ones, = no guess. Nothing is derived from a name or a handle (a derived address is a blind guess), nothing is
// looked up elsewhere, and nothing is matched to another account (docs/channel-capture-ck-8502.md: no identity matching).
//
// How the guess travels: sealed into an AES-256-GCM token that sits in the URL FRAGMENT of the bridge link (`#g=...`). A fragment is never sent to any server,
// so it is not in Cloudflare or GA4 page_location, and the page removes it from the address bar as soon as it has been read. The page posts the token
// to the Worker, which opens it and answers with the address. The address is not stored anywhere on our side, in a log or in an event: the token is the only
// place it exists between the bot and the person's browser. It expires after 24 hours.
//
// Gates (all must hold): env.EMAIL_GUESS_ENABLED is the exact string "true" and env.EMAIL_GUESS_KEY (a Worker secret, created by Chris) is set. With either
// missing nothing is issued and the endpoint answers 404.

export const MIN_CONFIDENCE = 0.8;
export const BIO_EMAIL_CONFIDENCE = 0.9;
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_TOKEN_CHARS = 1000;
const MAX_BIO_CHARS = 2000;
const MIN_KEY_CHARS = 16;
const FORMAT = "v1";
const LABEL = "mpt-email-guess-v1";

export type GuessBasis = "bio_email";

export interface EmailGuess {
  email: string;
  confidence: number;
  basis: GuessBasis;
}

export interface OpenedGuess extends EmailGuess {
  /** The channel the bridge link was sent on ("x"). Lower-case letters, digits and underscore only. */
  channel: string;
}

// ---- finding a published address -------------------------------------------------------------------------------------------------------------

// Anchored on both sides so an address is never cut out of the middle of something longer (a 70-character local part would otherwise lose its front
// and a TLD followed by more letters or digits would lose its end, either of which is a DIFFERENT, wrong address).
const CANDIDATE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}(?![A-Za-z0-9-])/g;

/** Strict syntax check: one @, sane lengths, no leading, trailing or doubled dots, real-looking labels. */
export function validEmail(value: string): boolean {
  if (typeof value !== "string" || value.length > 254) return false;
  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@")) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (!/^[A-Za-z0-9._%+-]+$/.test(local)) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((l) => l.length >= 1 && l.length <= 63 && /^[A-Za-z0-9-]+$/.test(l) && !l.startsWith("-") && !l.endsWith("-"))) return false;
  return /^[A-Za-z]{2,24}$/.test(labels[labels.length - 1]);
}

/** The distinct, valid addresses written in a piece of text, lower-cased, in order of first appearance. */
export function addressesIn(text: unknown): string[] {
  if (typeof text !== "string") return [];
  const found: string[] = [];
  for (const m of text.slice(0, MAX_BIO_CHARS).matchAll(CANDIDATE)) {
    const e = m[0].toLowerCase();
    if (validEmail(e) && !found.includes(e)) found.push(e);
  }
  return found;
}

/**
 * The guess for one person's public profile, or null when there is none worth showing. Only the bio text is read. Exactly one distinct address in it is
 * a guess (they published it themselves); zero, or two or more different ones, is "we do not know" and the page asks as usual.
 */
export function guessFromProfile(profile: { bio?: unknown } | null | undefined): EmailGuess | null {
  const found = addressesIn(profile?.bio);
  if (found.length !== 1) return null;
  const guess: EmailGuess = { email: found[0], confidence: BIO_EMAIL_CONFIDENCE, basis: "bio_email" };
  return guess.confidence >= MIN_CONFIDENCE ? guess : null;
}

// ---- the token ----------------------------------------------------------------------------------------------------------------------------

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64u(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64u(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("mpt-email-guess-salt-v1"), info: enc.encode(LABEL) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

const CHANNEL = /^[a-z0-9_]{1,16}$/;

/**
 * Seals one guess into a token for the bridge link fragment. Returns null (nothing issued) when the key is missing or too short, the channel is not a plain
 * word, or the guess is below the minimum confidence or not a valid address. Never throws.
 */
export async function sealGuess(secret: string | undefined, guess: EmailGuess, channel: string, opts: { now?: number; ttlMs?: number } = {}): Promise<string | null> {
  try {
    if (!secret || secret.length < MIN_KEY_CHARS) return null;
    if (!CHANNEL.test(channel) || !validEmail(guess.email) || !(guess.confidence >= MIN_CONFIDENCE) || guess.basis !== "bio_email") return null;
    const exp = (opts.now ?? Date.now()) + (opts.ttlMs ?? DEFAULT_TTL_MS);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const body = enc.encode(JSON.stringify({ e: guess.email, c: channel, s: guess.confidence, b: guess.basis, x: exp }));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(LABEL) }, await deriveKey(secret), body));
    const token = `${FORMAT}.${toB64u(iv)}.${toB64u(ct)}`;
    return token.length <= MAX_TOKEN_CHARS ? token : null;
  } catch {
    return null;
  }
}

/** Opens a token. Returns null for anything wrong with it: malformed, too long, wrong key, tampered, expired, below the confidence floor. Never throws. */
export async function openGuess(secret: string | undefined, token: unknown, now: number = Date.now()): Promise<OpenedGuess | null> {
  try {
    if (!secret || secret.length < MIN_KEY_CHARS || typeof token !== "string" || token.length > MAX_TOKEN_CHARS) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== FORMAT) return null;
    const iv = fromB64u(parts[1]);
    const ct = fromB64u(parts[2]);
    if (!iv || !ct || iv.length !== 12 || ct.length < 17) return null;
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: enc.encode(LABEL) }, await deriveKey(secret), ct);
    const o = JSON.parse(dec.decode(plain)) as Record<string, unknown>;
    if (typeof o.x !== "number" || o.x <= now) return null;
    if (typeof o.e !== "string" || !validEmail(o.e)) return null;
    if (typeof o.c !== "string" || !CHANNEL.test(o.c)) return null;
    if (typeof o.s !== "number" || !(o.s >= MIN_CONFIDENCE) || o.s > 1) return null;
    if (o.b !== "bio_email") return null;
    return { email: o.e, channel: o.c, confidence: o.s, basis: "bio_email" };
  } catch {
    return null;
  }
}

/** True only when the switch is the exact string "true" and a key of usable length is set. */
export const emailGuessOn = (env: { EMAIL_GUESS_ENABLED?: string; EMAIL_GUESS_KEY?: string } | undefined | null): boolean =>
  env?.EMAIL_GUESS_ENABLED === "true" && typeof env.EMAIL_GUESS_KEY === "string" && env.EMAIL_GUESS_KEY.length >= MIN_KEY_CHARS;
