// MPC-9783: runs the yes/no "does this ask us to stop contacting them, or about their personal data?" check over flag-set.json (SYNTHETIC only) through an OpenAI-compatible endpoint.
// Usage: QWEN_API_KEY=... node run-flag.mjs <out.json> [flag-set.json]   Env: QWEN_BASE_URL (default DashScope intl), QWEN_MODEL (default qwen-plus)
// A request that fails after retries is written as "ERROR" and an unreadable answer as "INVALID"; the scorer counts both as "yes" (in production, an error raises the message to a person).
import { readFileSync, writeFileSync } from 'node:fs';
import { FLAG_SYSTEM, wrapMessage } from '../../shared/triage/prompts.js';
import { parseFlag } from '../../shared/triage/parse.js';
export { parseFlag };
const [,, out, setPath = new URL('./flag-set.json', import.meta.url).pathname] = process.argv;
const isMain = process.argv[1] === new URL(import.meta.url).pathname;
const key = process.env.QWEN_API_KEY;
if (isMain && (!out || !key)) { console.error('usage: QWEN_API_KEY=... node run-flag.mjs <out.json> [flag-set.json]  (QWEN_API_KEY is required)'); process.exit(2); }
const base = (process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
const model = process.env.QWEN_MODEL || 'qwen-plus';
const system = FLAG_SYSTEM;   // the one shared copy (shared/triage/prompts.js)
const items = !isMain ? [] : JSON.parse(readFileSync(setPath, 'utf8'));

async function once(text) {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: wrapMessage(text, 'Answer (yes or no):') }] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFlag((await res.json())?.choices?.[0]?.message?.content);
}
async function ask(text, attempts = 3) {
  for (let n = 1; ; n++) { try { return await once(text); } catch (e) { if (n >= attempts) throw e; await new Promise((r) => setTimeout(r, 400 * n)); } }
}
if (isMain) {
  const flags = {}; let i = 0, failed = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (i < items.length) { const it = items[i++]; try { flags[it.id] = await ask(it.text); } catch (e) { failed++; flags[it.id] = 'ERROR'; console.error(`${it.id}: gave up after retries (${e.message})`); } }
  }));
  writeFileSync(out, JSON.stringify(flags));
  console.log(`model ${model}: wrote ${Object.keys(flags).length} answers, ${failed} request errors`);
  process.exit(failed ? 1 : 0);
}
