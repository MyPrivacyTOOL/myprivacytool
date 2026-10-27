// MPC-7892: turns the Telegram test-account feature flags on or off for the social-listeners Worker without touching anything else.
// Reads the Worker's current settings from the Cloudflare API, changes only the allow-listed plain-text flag bindings and PATCHes the
// full binding list back with every other binding marked "inherit" (secrets keep their values). Values are never printed, only names.
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, FLAG_SET (optional), FLAG_VALUE ("on" | "off"), MODE ("dry-run" | "apply").
// MPC-7894: FLAG_SET picks which flags this run changes; every other binding is left as it is. Default = the original pair.
const FLAG_SETS = { "baseline-and-deep": ["TELEGRAM_BASELINE_SCAN", "TELEGRAM_DEEP_SCAN"], "fix-wizard": ["TELEGRAM_FIX_WIZARD"], dashboard: ["TELEGRAM_DASHBOARD_LINKS"] }; // MPC-7893: the dashboard link flag is its own set
const FLAGS = FLAG_SETS[process.env.FLAG_SET || "baseline-and-deep"];
if (!FLAGS) throw new Error(`FLAG_SET must be one of: ${Object.keys(FLAG_SETS).join(", ")}`);
const WORKER = "social-listeners";
const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, FLAG_VALUE: value, MODE: mode } = process.env;
if (!token || !account) throw new Error("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required");
if (!["on", "off"].includes(value ?? "")) throw new Error('FLAG_VALUE must be "on" or "off"');
if (!["dry-run", "apply"].includes(mode ?? "")) throw new Error('MODE must be "dry-run" or "apply"');

const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${WORKER}/settings`;
async function api(method, body) {
  const res = await fetch(base, { method, headers: { Authorization: `Bearer ${token}` }, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(`Cloudflare ${method} settings failed: HTTP ${res.status} ${JSON.stringify((json.errors ?? []).map((e) => e.message))}`);
  return json.result ?? {};
}
const summary = (bindings) => bindings.map((b) => `${b.name}:${b.type}`).sort();

const current = await api("GET");
const before = current.bindings ?? [];
console.log("bindings before:", summary(before).join(", "));
const names = new Set(before.map((b) => b.name));
for (const need of ["PROBE_TELEGRAM_IDS", "TELEGRAM_BOT_TOKEN"]) if (!names.has(need)) throw new Error(`${need} is not set on ${WORKER}; refusing to change flags`);
const probeMode = before.find((b) => b.name === "PROBE_MODE");
console.log("PROBE_MODE present:", !!probeMode, "(value not printed)");

const kept = before.filter((b) => !FLAGS.includes(b.name)).map((b) => ({ name: b.name, type: "inherit" }));
const next = value === "on" ? [...kept, ...FLAGS.map((name) => ({ name, type: "plain_text", text: "on" }))] : kept;
console.log("bindings after (planned):", summary(next).join(", "));
if (mode === "dry-run") { console.log("dry-run: nothing changed"); process.exit(0); }

const form = new FormData();
form.append("settings", JSON.stringify({ bindings: next }));
await api("PATCH", form);

const after = (await api("GET")).bindings ?? [];
const lost = summary(before).filter((s) => !FLAGS.some((f) => s.startsWith(`${f}:`)) && !summary(after).includes(s));
if (lost.length) throw new Error(`bindings missing after change: ${lost.join(", ")}. Re-run "Deploy core-brain & social-listeners" to re-sync secrets.`);
const flagsNow = after.filter((b) => FLAGS.includes(b.name)).map((b) => `${b.name}=${b.text === "on" ? "on" : "(not on)"}`);
console.log("applied. flags now:", flagsNow.join(", ") || "(none)");
if ((value === "on") !== (flagsNow.length === FLAGS.length && flagsNow.every((f) => f.endsWith("=on")))) throw new Error("flags do not match the requested state");
