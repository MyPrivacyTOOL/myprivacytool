// MPC-7251: registers and verifies the Telegram bot webhook from repo secrets, so nobody has to build a setWebhook link
// by hand or paste a token anywhere. TELEGRAM_WEBHOOK_SECRET is the same secret deploy.yml pushes to the Worker, so the
// secret Telegram sends can never differ from the one the Worker checks (that mismatch was the 401 on 2026-10-10).
// Output is limited to pass/fail, status codes, the bot username and counts. Tokens and secrets are never printed.
import { pathToFileURL } from "node:url";

export const WEBHOOK_URL = "https://social-listeners.myprivacytool.workers.dev/webhook/telegram";
// Telegram: secret_token is 1-256 characters of A-Z a-z 0-9 _ -
export const SECRET_RE = /^[A-Za-z0-9_-]{1,256}$/;

export async function run({ env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const secret = env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const url = env.WEBHOOK_URL || WEBHOOK_URL;
  const drop = String(env.DROP_PENDING_UPDATES ?? "true") === "true";
  const fail = (msg) => {
    log(`FAIL: ${msg}`);
    return false;
  };
  const redact = (s) => String(s).split(token || "\u0000").join("<token>");
  const tg = async (method, body) => {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };

  if (!token) return fail("GitHub secret TELEGRAM_BOT_TOKEN is not set (Settings > Secrets and variables > Actions).");
  if (!secret) return fail("GitHub secret TELEGRAM_WEBHOOK_SECRET is not set.");
  if (!SECRET_RE.test(secret)) {
    return fail("TELEGRAM_WEBHOOK_SECRET must be 1-256 characters of letters, digits, _ or - (no spaces, blank lines or symbols). Re-save it.");
  }

  try {
    const me = await tg("getMe");
    if (!me.json.ok) return fail(`Telegram rejected the bot token (getMe status ${me.status}). Revoke and re-copy it in BotFather.`);
    log(`bot: @${me.json.result.username}`);

    const set = await tg("setWebhook", { url, secret_token: secret, drop_pending_updates: drop, allowed_updates: ["message"] });
    if (!set.json.ok) return fail(`setWebhook failed (status ${set.status}): ${redact(set.json.description ?? "no description")}`);
    log(`setWebhook: ok (drop_pending_updates=${drop})`);

    const info = (await tg("getWebhookInfo")).json.result ?? {};
    log(`webhook url ok: ${info.url === url}, pending updates: ${info.pending_update_count ?? "?"}`);
    if (info.url !== url) return fail("Telegram reports a different webhook URL than the one just set.");
    if (info.last_error_message) return fail(`Telegram reports a delivery error: ${redact(info.last_error_message)}`);

    // Live probe of the deployed Worker. A synthetic update with no message is acknowledged and answered with nothing,
    // so no user is messaged. 401 on the right secret means the deploy has not picked the secret up yet.
    const post = (headers) =>
      fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ update_id: 0 }) });
    const wrong = await post({ "X-Telegram-Bot-Api-Secret-Token": "wrong" });
    if (wrong.status !== 401) return fail(`Worker answered ${wrong.status} to a wrong secret (expected 401): it is not failing closed.`);
    const right = await post({ "X-Telegram-Bot-Api-Secret-Token": secret });
    if (right.status === 401) return fail("Worker answered 401 to the real secret: re-run 'Deploy core-brain & social-listeners' so the Worker gets the current TELEGRAM_WEBHOOK_SECRET.");
    if (!right.ok) return fail(`Worker answered ${right.status} to a valid update (expected 200): check core-brain and CORE_BRAIN_TOKEN.`);
    log("worker probe: wrong secret -> 401, real secret -> 200");

    log("note: replies also need TELEGRAM_BOT_TOKEN on the Worker (the deploy log must show 5 secrets); send 'hi' to the bot to confirm.");
    log("PASS");
    return true;
  } catch (err) {
    return fail(`unexpected error: ${redact(err instanceof Error ? err.message : err)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit((await run()) ? 0 : 1);
}
