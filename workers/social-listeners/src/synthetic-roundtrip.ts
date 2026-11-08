// CK-9912 / MPC-9850: synthetic Telegram round-trip, run INSIDE the Worker so CI needs no Telegram id and no GitHub secret for it.
// POST /synthetic/telegram-roundtrip with X-Telegram-Bot-Api-Secret-Token = TELEGRAM_WEBHOOK_SECRET. The Worker builds a "/start scan" private-chat update from the
// FIRST id in the SYNTHETIC_IDS secret (the owner's own test account), runs it through the normal webhook handler (core-brain, real Bot API sendMessage), then reads
// telegram_event_log for that update_id and returns in / brain / out timestamps. The id is never read from captured data, never sent anywhere else, and never returned.
import { type Env, recipientCtx } from "./shared";
import { callRecipient } from "../../../shared/recipients/outbound";
import { syntheticIds } from "./event-log";
import { handleTelegramWebhook, verifyTelegramSecret } from "./telegram-webhook";

export const BUDGET_MS = 60_000;

interface LogRow { created_at: string; direction: string; kind: string; payload?: { outcome?: string; status?: number; response?: { ok?: boolean; description?: string }; request?: { text?: string } } }

/** Pure verdict over the event-log rows of one update. */
export function evaluate(rows: LogRow[]) {
  const by = (d: string, k: string) => rows.find((r) => r.direction === d && r.kind === k);
  const inn = by("in", "message");
  const brain = by("brain", "core-brain");
  const out = by("out", "sendMessage");
  const problems: string[] = [];
  if (!inn) problems.push("no inbound row: the update was not logged");
  if (!brain) problems.push("no brain row: core-brain did not answer");
  else if (brain.payload?.outcome && brain.payload.outcome !== "ok") problems.push(`core-brain outcome: ${brain.payload.outcome}`);
  if (!out) problems.push("no sendMessage row: no reply was sent");
  else if (out.payload?.status !== 200 || out.payload?.response?.ok !== true) problems.push(`Telegram refused the reply (status ${out.payload?.status}, ${String(out.payload?.response?.description ?? "").slice(0, 80)})`);
  return { pass: problems.length === 0, problems, inn, brain, out };
}

const json = (body: unknown, status = 200): Response => Response.json(body, { status });

export async function handleSyntheticRoundtrip(request: Request, env: Env, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<Response> {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
  if (!verifyTelegramSecret(request, env)) return new Response("Unauthorized", { status: 401 });
  const id = [...syntheticIds(env)][0];
  if (!id) return json({ configured: false, error: "SYNTHETIC_IDS is not set" }, 503);
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return json({ configured: false, error: "SUPABASE_URL / SUPABASE_KEY not set" }, 503);

  const updateId = 2_000_000_000 + Math.floor(Math.random() * 900_000_000);
  const sentAt = Date.now();
  const update = { update_id: updateId, message: { message_id: 1, date: Math.floor(sentAt / 1000), chat: { id: Number(id), type: "private" }, from: { id: Number(id), is_bot: false, first_name: "MPT synthetic check" }, text: "/start scan", entities: [{ offset: 0, length: 6, type: "bot_command" }] } };
  const inner = new Request("https://internal/webhook/telegram", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": env.TELEGRAM_WEBHOOK_SECRET ?? "", "Content-Type": "application/json" }, body: JSON.stringify(update) });
  const res = await handleTelegramWebhook(inner, env); // no ctx: awaits the reply and the log writes
  if (!res.ok) return json({ pass: false, problems: [`webhook handler answered ${res.status}`] }, 200);

  const base = `${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/telegram_event_log`;
  const headers = { apikey: env.SUPABASE_KEY, authorization: `Bearer ${env.SUPABASE_KEY}` };
  let verdict = evaluate([]);
  const deadline = sentAt + BUDGET_MS;
  do {
    const r = await callRecipient("supabase", { url: `${base}?update_id=eq.${updateId}&select=created_at,direction,kind,payload&order=created_at.asc`, init: { headers, signal: AbortSignal.timeout(5000) }, sent: [] }, recipientCtx(env)).catch(() => null);
    if (r?.ok) verdict = evaluate((await r.json()) as LogRow[]);
    if (verdict.pass) break;
    await sleep(2000);
  } while (Date.now() < deadline);

  const at = (r?: LogRow) => r?.created_at ?? null;
  const ms = verdict.out ? Date.parse(verdict.out.created_at) - sentAt : null;
  return json({
    pass: verdict.pass && ms !== null && ms <= BUDGET_MS, problems: verdict.problems, update_id: updateId, sent_at: new Date(sentAt).toISOString(),
    in_at: at(verdict.inn), brain_at: at(verdict.brain), out_at: at(verdict.out), ms, budget_ms: BUDGET_MS,
    reply_text_start: String(verdict.out?.payload?.request?.text ?? "").slice(0, 90).replace(/\s+/g, " "),
  });
}
