// MPC-7894 Telegram fix wizard (allow-listed test accounts only, default off: TELEGRAM_FIX_WIZARD=on). "/fix" lists the issues from the sender's latest baseline
// snapshot; inline buttons walk one issue at a time (contextual question -> guide -> "I fixed it" / keep / skip / back). The USER changes their own settings.
// Four things stay separate and are never merged into one score: the baseline (never overwritten), the user's intention, the self-report, and the re-check observation.
// Skipping, keeping or closing a prompt is never completion. Sharing is a plain Telegram share link the user chooses to open: nothing personal is in it.
import { RISK_VERSION, SCAN_VERSION } from "./baseline-scan";
import { DRAFT_BANNER, type Guide, guideFor, listedGuides } from "./fix-guides";
import { type BaselineRow, type Outcome, RECHECK_VERSION, type Recheck, type Summary, issueOutcome, recheckFrom, summarise, comparable } from "./fix-recheck";
import type { Logger } from "./logger";
import { call, probeIds } from "./probe-reader";
import type { Env } from "./shared";

const TIMEOUT_MS = 5000;
const DAY_MS = 86_400_000;
const MAX_RECHECKS_PER_HOUR = 5;
const SCAN_URL = "https://myprivacytool.io/scan?utm_source=telegram&utm_medium=channel_osint&utm_campaign=fix_wizard";
const PLANS_URL = "https://myprivacytool.io/pricing?utm_source=telegram&utm_medium=channel_osint&utm_campaign=fix_wizard";
const SHARE_TEXT = "I checked what my Telegram profile shows to bots with MyPrivacyTOOL.";
const HELP_LINE = "Send /fix any time to see this list again. You change your own Telegram settings; I cannot change them for you.";

export const fixWizardEnabled = (env: Env): boolean => env.TELEGRAM_FIX_WIZARD === "on";

interface Cb { id: string; fromId: string; chatId: string; messageId: number | null; data: string }
type Parsed = { kind: "list"; fromId: string; chatId: string } | { kind: "cb"; cb: Cb };

/** "/fix" (exact) in a private chat, or a callback_query whose data starts "fw|" from a private chat. Anything else: null. */
export function parseFixUpdate(update: unknown): Parsed | null {
  const u = update as { message?: { text?: unknown; from?: { id?: unknown; is_bot?: unknown }; chat?: { id?: unknown; type?: unknown } };
    callback_query?: { id?: unknown; data?: unknown; from?: { id?: unknown; is_bot?: unknown }; message?: { message_id?: unknown; chat?: { id?: unknown; type?: unknown } } } };
  const m = u.message;
  if (m && typeof m.text === "string" && /^\/fix(@\w+)?$/i.test(m.text.trim()) && m.chat?.type === "private" && m.from?.is_bot !== true
    && typeof m.from?.id === "number" && m.chat.id === m.from.id) return { kind: "list", fromId: String(m.from.id), chatId: String(m.chat.id) };
  const q = u.callback_query;
  if (q && typeof q.data === "string" && q.data.startsWith("fw|") && typeof q.id === "string" && q.from?.is_bot !== true && typeof q.from?.id === "number"
    && q.message?.chat?.type === "private" && q.message.chat.id === q.from.id)
    return { kind: "cb", cb: { id: q.id, fromId: String(q.from.id), chatId: String(q.message.chat.id), messageId: typeof q.message.message_id === "number" ? q.message.message_id : null, data: q.data } };
  return null;
}

export const isFixWizardUpdate = (env: Env, update: unknown): boolean => {
  if (!fixWizardEnabled(env)) return false;
  const p = parseFixUpdate(update);
  return !!p && probeIds(env).has(p.kind === "list" ? p.fromId : p.cb.fromId);
};

async function rest(env: Env, method: string, path: string, body?: unknown, prefer?: string): Promise<{ ok: boolean; rows: Record<string, unknown>[] }> {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return { ok: false, rows: [] };
  try {
    const res = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/${path}`, {
      method, headers: { apikey: env.SUPABASE_KEY, authorization: `Bearer ${env.SUPABASE_KEY}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let rows: Record<string, unknown>[] = [];
    try { const j = await res.json(); rows = Array.isArray(j) ? j : []; } catch { /* empty body */ }
    return { ok: res.ok, rows };
  } catch { return { ok: false, rows: [] }; }
}

interface Item { issue_id: string; intention: string | null; context_answer: string | null; self_confirmed_at: string | null; recheck_outcome: string | null }
type Button = { text: string; callback_data?: string; url?: string };
interface View { text: string; keyboard?: Button[][] }
const b8 = (id: string): string => id.replace(/-/g, "").slice(0, 8);
const data = (base: BaselineRow, ...parts: string[]): string => ["fw", b8(base.id), ...parts].join("|");
const day = (iso: string): string => iso.slice(0, 10);

async function loadBaseline(env: Env, senderId: string): Promise<BaselineRow | "error" | null> {
  const r = await rest(env, "GET", `profile_snapshots?sender_id=eq.${senderId}&scan_version=eq.${SCAN_VERSION}&status=eq.complete&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&order=created_at.desc&limit=1&select=id,created_at,scan_version,risk_version,report`);
  if (!r.ok) return "error";
  return (r.rows[0] as unknown as BaselineRow | undefined) ?? null;
}
async function loadItems(env: Env, senderId: string, base: BaselineRow): Promise<Map<string, Item> | "error"> {
  const r = await rest(env, "GET", `fix_wizard_items?sender_id=eq.${senderId}&baseline_snapshot_id=eq.${base.id}&select=issue_id,intention,context_answer,self_confirmed_at,recheck_outcome`);
  return r.ok ? new Map(r.rows.map((x) => [String(x.issue_id), x as unknown as Item])) : "error";
}
async function saveItem(env: Env, senderId: string, base: BaselineRow, issue: string, fields: Record<string, unknown>): Promise<boolean> {
  const row = { sender_id: senderId, baseline_snapshot_id: base.id, issue_id: issue, updated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 90 * DAY_MS).toISOString(), ...fields };
  return (await rest(env, "POST", "fix_wizard_items?on_conflict=sender_id,baseline_snapshot_id,issue_id", row, "resolution=merge-duplicates,return=minimal")).ok;
}

function status(g: Guide, it: Item | undefined): string {
  if (it?.recheck_outcome === "verified_change") return "VERIFIED (bot no longer receives it)";
  if (it?.self_confirmed_at) return "SELF-CONFIRMED (not checked)";
  if (it?.intention === "keep") return "kept as is";
  if (it?.intention === "skip") return "skipped";
  return "not started";
}

function listView(base: BaselineRow, items: Map<string, Item>): View {
  const guides = listedGuides();
  return {
    text: ["Fix list from your scan of " + day(base.created_at) + ".", "Pick an item. Skipping or keeping something is fine; it does not count as fixed.", "", ...guides.map((g) => `${g.label}: ${status(g, items.get(g.code))}`), "", HELP_LINE].join("\n"),
    keyboard: [...guides.map((g) => [{ text: g.label, callback_data: data(base, "o", g.code) }]), [{ text: "Scan again", callback_data: data(base, "r") }]],
  };
}
function questionView(base: BaselineRow, g: Guide): View {
  return { text: `${g.label}\n\n${g.question}\n\nYour answer only changes the advice I show.`, keyboard: [
    [{ text: g.options[0].label, callback_data: data(base, "qa", g.code) }], [{ text: g.options[1].label, callback_data: data(base, "qb", g.code) }],
    [{ text: "Skip for now", callback_data: data(base, "s", g.code) }, { text: "Back to list", callback_data: data(base, "l") }]] };
}
function guideView(base: BaselineRow, g: Guide, answer: "a" | "b"): View {
  const opt = g.options[answer === "a" ? 0 : 1];
  const lines = [g.label, "", opt.advice, "", ...(g.evidence ? [] : [DRAFT_BANNER, ""]), ...g.steps.map((s, i) => `${i + 1}. ${s}`), "",
    g.kind === "api" ? "When you tap \"I fixed it\" I will look at your profile again as Telegram shows it to this bot. That shows what the bot receives, not who else can see it."
      : "I cannot check this setting. Tapping \"I fixed it\" only records that you say you did it."];
  return { text: lines.join("\n"), keyboard: [
    [{ text: "I fixed it", callback_data: data(base, "f", g.code) }, { text: "Keep as is", callback_data: data(base, "k", g.code) }],
    [{ text: "Skip for now", callback_data: data(base, "s", g.code) }, { text: "Back", callback_data: data(base, "o", g.code) }]] };
}

const OUTCOME_TEXT: Record<Outcome, string> = {
  verified_change: "VERIFIED (observed by the bot): this is no longer returned to the bot in the re-check. That is what the bot receives; it does not prove who else can or cannot see it.",
  no_change: "No change observed: the bot still receives this. The change may not have taken effect yet, or this setting still lets bots see it.",
  not_in_baseline: "Nothing to compare: the bot did not receive this in your first scan either, so I cannot show a change.",
  new_exposure: "New: the bot receives this now but did not in your first scan.",
  unavailable: "I could not re-check just now (Telegram did not answer). Nothing was changed or scored. Try again later.",
  incomparable: "I cannot compare this with your first scan because it was made with a different version of the check. Nothing was scored.",
  partial: "Only part of the check worked, so I cannot compare this item. Nothing was scored.",
};

async function runRecheck(env: Env, base: BaselineRow, senderId: string, from: unknown, updateId: number): Promise<{ r: Recheck; saved: boolean; duplicate: boolean; rateLimited: boolean; snapshotId: string | null }> {
  const since = encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString());
  const recent = await rest(env, "GET", `profile_snapshots?sender_id=eq.${senderId}&scan_version=eq.${RECHECK_VERSION}&created_at=gte.${since}&select=id`);
  if (recent.ok && recent.rows.length >= MAX_RECHECKS_PER_HOUR) return { r: { completeness: "failed", hexagons: [], notes: ["rate limited"] }, saved: false, duplicate: false, rateLimited: true, snapshotId: null };
  const [chat, photos] = await Promise.all([call(env, "getChat", { chat_id: senderId }), call(env, "getUserProfilePhotos", { user_id: Number(senderId), limit: 5 })]);
  const r = recheckFrom(from, updateId, chat, photos);
  const row = {
    platform: "telegram", sender_id: senderId, update_id: updateId, status: r.completeness === "failed" ? "failed" : "complete", scan_version: RECHECK_VERSION, risk_version: RISK_VERSION, schema_version: 1, score: null,
    consent: { basis: "explicit I-fixed-it / Scan-again tap", baseline_snapshot_id: base.id, confirming_update_id: updateId },
    consent_at: new Date().toISOString(), get_chat: { redacted: true }, photos: { redacted: true },
    report: { kind: "recheck", baseline_snapshot_id: base.id, completeness: r.completeness, notes: r.notes, hexagons: r.hexagons },
    expires_at: new Date(Date.now() + 90 * DAY_MS).toISOString(),
  };
  const ins = await rest(env, "POST", "profile_snapshots?on_conflict=platform,sender_id,update_id", row, "resolution=ignore-duplicates,return=representation");
  return { r, saved: ins.ok, duplicate: ins.ok && ins.rows.length === 0, rateLimited: false, snapshotId: ins.rows[0] ? String(ins.rows[0].id) : null };
}

function summaryText(base: BaselineRow, s: Summary | null, r: Recheck, items: Map<string, Item>): string {
  const selfDone = listedGuides().filter((g) => g.kind === "self" && items.get(g.code)?.self_confirmed_at);
  const self = listedGuides().filter((g) => g.kind === "self");
  const lines: string[] = ["Scan again (" + day(new Date().toISOString()) + ")", ""];
  if (r.completeness === "failed") lines.push(OUTCOME_TEXT.unavailable);
  else if (!s) lines.push(OUTCOME_TEXT.incomparable);
  else {
    lines.push("OBSERVED by the bot, same fields both times:", `Before (${day(base.created_at)}): ${s.before} of ${s.compared} returned to the bot.`, `Now: ${s.after} of ${s.compared} returned.`,
      ...(s.gone.length ? [`No longer returned: ${s.gone.length} item(s).`] : []), ...(s.appeared.length ? [`Newly returned: ${s.appeared.length} item(s).`] : []),
      ...(s.skipped ? [`${s.skipped} item(s) could not be compared this time.`] : []), ...(r.completeness === "partial" ? ["Only part of the check worked (" + r.notes.join(", ") + ")."] : []),
      "A lower number means the bot receives less. It is not proof that you are safer in real life or that every exposure is resolved.");
  }
  lines.push("", `SELF-CONFIRMED by you (not checked, kept separate): ${selfDone.length} of ${self.length} settings. I cannot see these settings.`, "",
    "Do more with /scan: " + SCAN_URL, "See plans: " + PLANS_URL, HELP_LINE);
  return lines.join("\n");
}

async function send(env: Env, chatId: string, messageId: number | null, v: View): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text: v.text, disable_web_page_preview: true, ...(v.keyboard ? { reply_markup: { inline_keyboard: v.keyboard } } : {}) };
  if (messageId !== null) {
    const e = await call(env, "editMessageText", { ...body, message_id: messageId });
    if (e.status === 200) return;
  }
  await call(env, "sendMessage", body);
}

const plain = (text: string): View => ({ text: text + "\n\n" + HELP_LINE });
const NO_BASELINE = plain("I have no current scan to work from (none yet, or it has expired or been deleted). Run the scan first, then send /fix.");
const STORAGE_ERROR = plain("I could not load your saved scan just now, so nothing was changed. Try again later.");
const STALE = plain("That list is out of date. Send /fix for a fresh one.");

/** Never throws, never logs payloads or tokens. */
export async function handleFixWizard(env: Env, update: unknown, log: Logger): Promise<void> {
  try {
    const p = parseFixUpdate(update);
    if (!p || !env.TELEGRAM_BOT_TOKEN) return;
    const fromId = p.kind === "list" ? p.fromId : p.cb.fromId;
    if (!probeIds(env).has(fromId)) return; // wrong user / not allow-listed: nothing is read or sent
    const chatId = p.kind === "list" ? p.chatId : p.cb.chatId;
    const messageId = p.kind === "cb" ? p.cb.messageId : null;
    if (p.kind === "cb") await call(env, "answerCallbackQuery", { callback_query_id: p.cb.id });
    const reply = (v: View) => send(env, chatId, messageId, v);

    const base = await loadBaseline(env, fromId);
    if (base === "error") return reply(STORAGE_ERROR);
    if (!base) return reply(NO_BASELINE);
    const items = await loadItems(env, fromId, base);
    if (items === "error") return reply(STORAGE_ERROR);
    if (p.kind === "list") return reply(listView(base, items));

    const [, snap, act, code] = p.cb.data.split("|");
    if (snap !== b8(base.id)) return reply(STALE);
    const g = code ? guideFor(code) : undefined;
    if (act === "l") return reply(listView(base, items));
    if (act === "r") return reply(await rescan(env, base, fromId, update, items, log));
    if (!g || !g.available) return reply(STALE);
    if (act === "o") return reply(questionView(base, g));
    if (act === "qa" || act === "qb") {
      const ok = await saveItem(env, fromId, base, g.code, { context_answer: act === "qa" ? "a" : "b" });
      return reply(ok ? guideView(base, g, act === "qa" ? "a" : "b") : STORAGE_ERROR);
    }
    if (act === "k" || act === "s") {
      const ok = await saveItem(env, fromId, base, g.code, { intention: act === "k" ? "keep" : "skip" });
      const fresh = await loadItems(env, fromId, base);
      return reply(ok && fresh !== "error" ? listView(base, fresh) : STORAGE_ERROR);
    }
    if (act === "f") return reply(await fixed(env, base, fromId, (update as { callback_query: { from: unknown } }).callback_query.from, (update as { update_id: number }).update_id, g, items, log));
    return reply(STALE);
  } catch (err) {
    log.warn("fix_wizard_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}

async function fixed(env: Env, base: BaselineRow, senderId: string, from: unknown, updateId: number, g: Guide, items: Map<string, Item>, log: Logger): Promise<View> {
  const already = items.get(g.code)?.self_confirmed_at;
  const stamp = already ?? new Date().toISOString();
  if (!(await saveItem(env, senderId, base, g.code, { intention: "change", self_confirmed_at: stamp }))) return STORAGE_ERROR;
  const back: Button[][] = [[{ text: "Back to list", callback_data: data(base, "l") }]];
  if (g.kind === "self") return { text: `${g.label}: recorded as SELF-CONFIRMED. I cannot check this setting, so it is not verified and it does not change any score.\n\n${HELP_LINE}`, keyboard: back };
  if (!g.hexagon) return STALE;
  const run = await runRecheck(env, base, senderId, from, updateId);
  if (run.rateLimited) return { text: "You have asked for several re-checks in the last hour. Your 'I fixed it' is recorded as SELF-CONFIRMED; try the re-check again later.\n\n" + HELP_LINE, keyboard: back };
  if (run.duplicate) return { text: `${g.label}: this request was already processed.\n\n${HELP_LINE}`, keyboard: back };
  const outcome = issueOutcome(base, run.r, g.hexagon);
  await saveItem(env, senderId, base, g.code, { recheck_outcome: outcome, recheck_snapshot_id: run.snapshotId, recheck_at: new Date().toISOString() });
  log.info("fix_wizard_recheck", { issue: g.code, outcome, saved: run.saved });
  return { text: `${g.label}\nYou said: fixed (self-reported).\nRe-check (${day(new Date().toISOString())}, compared with your scan of ${day(base.created_at)}):\n${OUTCOME_TEXT[outcome]}\n\n${HELP_LINE}`, keyboard: back };
}

async function rescan(env: Env, base: BaselineRow, senderId: string, update: unknown, items: Map<string, Item>, log: Logger): Promise<View> {
  const q = (update as { update_id: number; callback_query: { from: unknown } });
  const run = await runRecheck(env, base, senderId, q.callback_query.from, q.update_id);
  if (run.rateLimited) return plain("You have asked for several re-checks in the last hour. Please try again later.");
  if (run.duplicate) return plain("That request was already processed. Send /fix to continue.");
  log.info("fix_wizard_rescan", { completeness: run.r.completeness, saved: run.saved, comparable: comparable(base) });
  const share = `https://t.me/share/url?url=${encodeURIComponent("https://myprivacytool.io/scan")}&text=${encodeURIComponent(SHARE_TEXT)}`;
  return { text: summaryText(base, summarise(base, run.r), run.r, items) + "\n\nOptional: the Share button opens Telegram's share picker with a generic message. It contains none of your details, and nothing is sent unless you choose a chat.",
    keyboard: [[{ text: "Share (optional)", url: share }], [{ text: "Back to list", callback_data: data(base, "l") }]] };
}
