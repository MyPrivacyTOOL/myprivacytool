// MPC-9850: synthetic Telegram round-trip against the DEPLOYED system, run from CI (the build sandbox cannot reach api.telegram.org or the Worker).
// A Bot API client can never message a bot (only a user session can), so the inbound half is the same signed request Telegram itself makes: a POST to the
// Worker's /webhook/telegram with X-Telegram-Bot-Api-Secret-Token = TELEGRAM_WEBHOOK_SECRET and a "/start scan" private-chat message from an id on
// PROBE_TELEGRAM_IDS (our own test account; never a real person's id). The outbound half is real: the Worker calls the Bot API sendMessage, and the
// full event log (public.telegram_event_log, PROBE_MODE=on, allow-listed sender) records the update (in), the core-brain answer (brain) and the sendMessage call
// with Telegram's answer (out). PASS needs all three, and Telegram answering ok to sendMessage, within 60 s. Tokens and secrets are never printed.
// Env: TELEGRAM_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and either SYNTHETIC_TELEGRAM_ID or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID (reads the
// plain-text PROBE_TELEGRAM_IDS binding and uses its first id). Exit 0 PASS, 1 FAIL, 2 NOT CONFIGURED (names the missing credential).
import { pathToFileURL } from "node:url";

export const WEBHOOK_URL = "https://social-listeners.myprivacytool.workers.dev/webhook/telegram";
export const BUDGET_MS = 60_000;

/** Pure verdict over the event-log rows of one update. */
export function evaluate(rows) {
  const by = (d, k) => rows.find((r) => r.direction === d && r.kind === k);
  const inn = by("in", "message");
  const brain = by("brain", "core-brain");
  const out = by("out", "sendMessage");
  const problems = [];
  if (!inn) problems.push("no inbound row: the Worker did not log the update (PROBE_MODE not on, or sender not on PROBE_TELEGRAM_IDS)");
  if (!brain) problems.push("no brain row: core-brain did not answer");
  else if (brain.payload?.outcome && brain.payload.outcome !== "ok") problems.push(`core-brain outcome: ${brain.payload.outcome}`);
  if (!out) problems.push("no sendMessage row: no reply was sent");
  else if (out.payload?.status !== 200 || out.payload?.response?.ok !== true) problems.push(`Telegram refused the reply (status ${out.payload?.status}, ${String(out.payload?.response?.description ?? "").slice(0, 80)})`);
  return { pass: problems.length === 0, problems, inn, brain, out };
}

export async function resolveSenderId(env, fetchImpl = fetch) {
  const given = (env.SYNTHETIC_TELEGRAM_ID ?? "").trim();
  if (/^\d{4,15}$/.test(given)) return given;
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) return null;
  const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/social-listeners/settings`, { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
  const b = ((await res.json().catch(() => ({}))).result?.bindings ?? []).find((x) => x.name === "PROBE_TELEGRAM_IDS");
  const id = b?.type === "plain_text" ? String(b.text ?? "").split(",").map((s) => s.trim()).find((s) => /^\d{4,15}$/.test(s)) : undefined;
  return id ?? null;
}

export async function run({ env = process.env, fetchImpl = fetch, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const secret = env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const sb = (env.SUPABASE_URL || "https://xmdmkumwxpgahmlweuug.supabase.co").replace(/\/$/, "");
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  for (const [n, v] of [["TELEGRAM_WEBHOOK_SECRET", secret], ["SUPABASE_SERVICE_ROLE_KEY", key]]) if (!v) { log(`NOT CONFIGURED: GitHub secret ${n} is not set`); return 2; }
  const id = await resolveSenderId(env, fetchImpl);
  if (!id) { log("NOT CONFIGURED: no synthetic sender id. PROBE_TELEGRAM_IDS on the Worker is not a readable plain-text binding; set repo variable/secret SYNTHETIC_TELEGRAM_ID to a numeric id already on PROBE_TELEGRAM_IDS."); return 2; }

  const updateId = 2_000_000_000 + Math.floor(Math.random() * 900_000_000);
  const sentAt = new Date();
  const update = { update_id: updateId, message: { message_id: 1, date: Math.floor(sentAt / 1000), chat: { id: Number(id), type: "private" }, from: { id: Number(id), is_bot: false, first_name: "MPT synthetic check" }, text: "/start scan", entities: [{ offset: 0, length: 6, type: "bot_command" }] } };
  const res = await fetchImpl(env.WEBHOOK_URL || WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret }, body: JSON.stringify(update) });
  log(`webhook POST update_id=${updateId} sent ${sentAt.toISOString()} -> HTTP ${res.status}`);
  if (!res.ok) { log(`FAIL: Worker answered ${res.status}${res.status === 401 ? " (secret mismatch: re-run the deploy)" : ""}`); return 1; }

  let verdict;
  const deadline = Date.now() + BUDGET_MS;
  do {
    await sleep(3000);
    const r = await fetchImpl(`${sb}/rest/v1/telegram_event_log?update_id=eq.${updateId}&select=created_at,direction,kind,payload&order=created_at.asc`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) { log(`FAIL: event log read HTTP ${r.status}`); return 1; }
    verdict = evaluate(await r.json());
  } while (!verdict.pass && Date.now() < deadline && !(verdict.out && verdict.brain && verdict.inn));
  for (const [label, row] of [["message in", verdict.inn], ["core-brain", verdict.brain], ["reply out", verdict.out]]) if (row) log(`${label.padEnd(10)} ${row.created_at}`);
  if (verdict.out?.payload?.request?.text) log(`reply text (first 90 chars): ${String(verdict.out.payload.request.text).slice(0, 90).replace(/\s+/g, " ")}`);
  if (verdict.pass) { const ms = new Date(verdict.out.created_at) - sentAt; log(`PASS: message in -> reply out in ${ms} ms (budget ${BUDGET_MS} ms), Telegram answered ok`); return ms <= BUDGET_MS ? 0 : 1; }
  for (const p of verdict.problems) log(`FAIL: ${p}`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(await run());
