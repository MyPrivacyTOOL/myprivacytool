// MPC-8689 pilot: Discord interactions endpoint. A person runs our slash command and sees, privately (ephemeral), what Discord sent us with that one command.
// The 11 hexagons are EXTRAS: checked, but outside every score and count until the owner approves a new score version. Nothing is stored and nothing is logged
// from the payload (metadata only). Default off (DISCORD_SCAN=on), allow-listed test accounts only (DISCORD_PROBE_IDS).
// Fields confirmed against docs.discord.com (Interaction object, User object, interactions security): Ed25519 over timestamp + raw body with X-Signature-Ed25519 and
// X-Signature-Timestamp, 401 on a bad signature, PING type 1 answered with PONG type 1, APPLICATION_COMMAND type 2, reply type 4 with flag 64 (ephemeral).
// Not built from the Discord candidates: email and verified, linked accounts, server list, Nitro and 2FA (all need the person to sign in with Discord).
import { createLogger } from "./logger";
import { type Env, readRawBody } from "./shared";
import type { ObservationState } from "../../../shared/hexagon-registry/channels.js";

const log = createLogger("social-listeners:discord");
const DISCORD_EPOCH = 1420070400000n;

export const DISCORD_EXTRA_HEXAGONS = [
  { id: "dc.user_id", label: "User ID and account age", arrival: "A", source: "user.id / member.user.id" },
  { id: "dc.names", label: "Username and display name", arrival: "A", source: "username, global_name" },
  { id: "dc.avatar", label: "Avatar and decorations", arrival: "A", source: "avatar, avatar_decoration_data, collectibles" },
  { id: "dc.server_tag", label: "Server tag", arrival: "A", source: "primary_guild" },
  { id: "dc.badges", label: "Badges", arrival: "A", source: "public_flags" },
  { id: "dc.language", label: "App language", arrival: "A", source: "interaction.locale" },
  { id: "dc.context", label: "Where they used us", arrival: "A", source: "context, guild_id, channel_id" },
  { id: "dc.member", label: "Server membership details", arrival: "A", source: "member object" },
  { id: "dc.purchases", label: "Purchases in our app", arrival: "A", source: "entitlements" },
  { id: "dc.command_input", label: "What you typed", arrival: "A", source: "data.options" },
  { id: "dc.banner", label: "Banner and colour", arrival: "B", source: "GET /users/{id} banner, accent_color" },
] as const;

export interface DiscordState { id: string; channel: "DC"; arrival: "A" | "B"; state: ObservationState }
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const filled = (v: unknown): boolean => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);

/** The person who ran the command: member.user in a server, user in a DM. */
export function interactionUser(i: Obj): Obj | null {
  return obj(obj(i.member)?.user) ?? obj(i.user);
}

/** Account creation time from the Discord user id (a snowflake). Null for anything that is not a plausible id. */
export function accountCreated(id: unknown): Date | null {
  if (typeof id !== "string" || !/^[0-9]{15,21}$/.test(id)) return null;
  const ms = Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
  return ms > 1420070400000 && ms < Date.now() + 86_400_000 ? new Date(ms) : null;
}

/**
 * One state per Discord extra from the interaction payload (pure). "returned" = Discord sent it with this command; "not_returned" = this payload did not carry it
 * (the person has none, or is in a DM, or typed no options); never "protected". dc.banner needs a separate lookup and is "not_checked" here.
 */
export function discordStates(interaction: unknown): DiscordState[] {
  const i = obj(interaction) ?? {};
  const u = interactionUser(i) ?? {};
  const data = obj(i.data) ?? {};
  const returned: Record<string, boolean> = {
    "dc.user_id": accountCreated(u.id) !== null,
    "dc.names": filled(u.username) || filled(u.global_name),
    "dc.avatar": filled(u.avatar) || filled(u.avatar_decoration_data) || filled(u.collectibles),
    "dc.server_tag": filled(u.primary_guild),
    "dc.badges": typeof u.public_flags === "number" && u.public_flags > 0,
    "dc.language": filled(i.locale),
    "dc.context": filled(i.context) || filled(i.guild_id) || filled(i.channel_id),
    "dc.member": obj(i.member) !== null,
    "dc.purchases": Array.isArray(i.entitlements) && i.entitlements.length > 0,
    "dc.command_input": filled(data.options) || filled(data.components),
  };
  return DISCORD_EXTRA_HEXAGONS.map((x) => ({
    id: x.id, channel: "DC" as const, arrival: x.arrival,
    state: x.id === "dc.banner" ? "not_checked" : returned[x.id] ? "returned" : "not_returned",
  }));
}

/** dc.banner: the public profile banner or colour, read with our bot token. Any failure is not_checked, never a guess. */
export async function bannerState(userId: unknown, token: string | undefined, fetchImpl: typeof fetch = fetch): Promise<ObservationState> {
  if (!token || typeof userId !== "string" || !/^[0-9]{15,21}$/.test(userId)) return "not_checked";
  try {
    const res = await fetchImpl(`https://discord.com/api/v10/users/${userId}`, { headers: { authorization: `Bot ${token}` }, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return "not_checked";
    const u = obj(await res.json());
    return u && (filled(u.banner) || filled(u.accent_color)) ? "returned" : "not_returned";
  } catch {
    return "not_checked";
  }
}

const month = (d: Date) => d.toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" });

/** The private reply. Lists only what was seen as seen; the account's creation month comes from the id. */
export function discordReply(states: DiscordState[], interaction: unknown): string {
  const label = (id: string) => DISCORD_EXTRA_HEXAGONS.find((x) => x.id === id)?.label ?? id;
  const seen = states.filter((x) => x.state === "returned").map((x) => label(x.id));
  const not = states.filter((x) => x.state === "not_returned").map((x) => label(x.id));
  const skipped = states.filter((x) => x.state === "not_checked").map((x) => label(x.id));
  const created = accountCreated(interactionUser(obj(interaction) ?? {})?.id);
  return [
    `What Discord sent us with this command (${seen.length} of ${states.filter((x) => x.state !== "not_checked").length} checked):`,
    `Seen: ${seen.join(", ") || "none"}`,
    ...(created ? [`Your account was created in ${month(created)} (that is in your id).`] : []),
    ...(not.length ? [`Not in this command: ${not.join(", ")}`] : []),
    ...(skipped.length ? [`Not checked: ${skipped.join(", ")}`] : []),
    "These are extra checks and are not part of any score. Nothing was stored. Only you can see this message.",
  ].join("\n");
}

// ---- signature (Ed25519 over timestamp + raw body)
const fromHex = (h: string): Uint8Array | null => (/^([0-9a-f]{2})+$/i.test(h) ? Uint8Array.from(h.match(/../g) as string[], (b) => parseInt(b, 16)) : null);
export async function verifyDiscordSignature(publicKeyHex: string | undefined, signatureHex: string | null, timestamp: string | null, rawBody: string): Promise<boolean> {
  if (!publicKeyHex || !signatureHex || !timestamp) return false; // fail closed
  const key = fromHex(publicKeyHex), sig = fromHex(signatureHex);
  if (!key || key.length !== 32 || !sig || sig.length !== 64) return false;
  try {
    const k = await crypto.subtle.importKey("raw", key, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, k, sig, new TextEncoder().encode(timestamp + rawBody));
  } catch {
    return false;
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const allowed = (env: Env, id: unknown): boolean => typeof id === "string" && (env.DISCORD_PROBE_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean).includes(id);

export async function handleDiscordInteraction(request: Request, env: Env, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (env.DISCORD_SCAN !== "on") return new Response("Not Found", { status: 404 });
  const raw = await readRawBody(request);
  if (raw === null) return new Response("Payload Too Large", { status: 413 });
  if (!(await verifyDiscordSignature(env.DISCORD_PUBLIC_KEY, request.headers.get("X-Signature-Ed25519"), request.headers.get("X-Signature-Timestamp"), raw))) {
    log.warn("signature_invalid");
    return new Response("invalid request signature", { status: 401 });
  }
  let interaction: Obj | null;
  try { interaction = obj(JSON.parse(raw)); } catch { interaction = null; }
  if (!interaction) return new Response("Bad Request", { status: 400 });
  if (interaction.type === 1) return json({ type: 1 }); // PING -> PONG
  if (interaction.type !== 2) return json({ type: 4, data: { content: "This command is not available.", flags: 64 } });
  const user = interactionUser(interaction);
  if (!allowed(env, user?.id)) {
    log.info("not_allowed");
    return json({ type: 4, data: { content: "This check is not available to you yet.", flags: 64 } });
  }
  const states = discordStates(interaction);
  const banner = await bannerState(user?.id, env.DISCORD_BOT_TOKEN, fetchImpl);
  const final = states.map((x) => (x.id === "dc.banner" ? { ...x, state: banner } : x));
  log.info("replied", { seen: final.filter((x) => x.state === "returned").length }); // counts only, never the payload
  return json({ type: 4, data: { content: discordReply(final, interaction), flags: 64, allowed_mentions: { parse: [] } } });
}
