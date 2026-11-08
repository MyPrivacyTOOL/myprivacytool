// MPC-9850 / CK-9912: synthetic Telegram round-trip against the DEPLOYED system, run from CI (the build sandbox cannot reach api.telegram.org or the Worker).
// The sender lives inside the social-listeners Worker: POST /synthetic/telegram-roundtrip (auth: X-Telegram-Bot-Api-Secret-Token = TELEGRAM_WEBHOOK_SECRET). The Worker
// sends a "/start scan" update as the FIRST id in its SYNTHETIC_IDS secret (the owner's own test account), runs it through the normal webhook (core-brain, real Bot API
// reply), reads telegram_event_log and answers with in / brain / out timestamps. CI holds no Telegram id. Exit 0 PASS, 1 FAIL, 2 NOT CONFIGURED.
import { pathToFileURL } from "node:url";

export const ENDPOINT = "https://social-listeners.myprivacytool.workers.dev/synthetic/telegram-roundtrip";
export const BUDGET_MS = 60_000;

export async function run({ env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  const secret = env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!secret) { log("NOT CONFIGURED: GitHub secret TELEGRAM_WEBHOOK_SECRET is not set"); return 2; }
  const res = await fetchImpl(env.ENDPOINT_URL || ENDPOINT, { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": secret }, signal: AbortSignal.timeout(BUDGET_MS + 15_000) }).catch((e) => ({ ok: false, status: 0, text: async () => String(e?.name ?? "error") }));
  if (res.status === 503) { log(`NOT CONFIGURED: ${(await res.json().catch(() => ({}))).error ?? "Worker secret missing"}`); return 2; }
  if (res.status === 401) { log("FAIL: Worker answered 401 (TELEGRAM_WEBHOOK_SECRET mismatch)"); return 1; }
  if (!res.ok) { log(`FAIL: Worker answered ${res.status}`); return 1; }
  const v = await res.json().catch(() => null);
  if (!v) { log("FAIL: unreadable answer"); return 1; }
  log(`sent       ${v.sent_at} (update_id ${v.update_id})`);
  for (const [l, k] of [["message in", "in_at"], ["core-brain", "brain_at"], ["reply out", "out_at"]]) if (v[k]) log(`${l.padEnd(10)} ${v[k]}`);
  if (v.reply_text_start) log(`reply text (first 90 chars): ${v.reply_text_start}`);
  if (v.pass) { log(`PASS: message in -> reply out in ${v.ms} ms (budget ${BUDGET_MS} ms), Telegram answered ok`); return 0; }
  for (const p of v.problems ?? []) log(`FAIL: ${p}`);
  if (v.ms !== null && v.ms > BUDGET_MS) log(`FAIL: reply took ${v.ms} ms (budget ${BUDGET_MS} ms)`);
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(await run());
