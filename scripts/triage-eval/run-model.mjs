// Runs the 100 synthetic messages through an OpenAI-compatible chat endpoint (Qwen via DashScope by default) and writes predictions.json for score.mjs.
// SYNTHETIC data only (dataset.jsonl): safe to send to a third-party model. Do NOT point this at real inbound mail.
// Usage: QWEN_API_KEY=... node run-model.mjs <out-predictions.json> [dataset.jsonl]
// Env: QWEN_API_KEY (required), QWEN_BASE_URL (default DashScope intl compatible-mode), QWEN_MODEL (default qwen-plus)
import { readFileSync, writeFileSync } from 'node:fs';
const CATS = ['support', 'complaint', 'unsubscribe_by_reply', 'partner', 'sales_reply', 'data_request', 'spam'];
const [,, out, dataPath = new URL('./dataset.jsonl', import.meta.url).pathname] = process.argv;
const key = process.env.QWEN_API_KEY;
const isMain = process.argv[1] === new URL(import.meta.url).pathname;
if (isMain && (!out || !key)) { console.error('usage: QWEN_API_KEY=... node run-model.mjs <out.json> [dataset.jsonl]  (QWEN_API_KEY is required)'); process.exit(2); }
const base = (process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
const model = process.env.QWEN_MODEL || 'qwen-plus';
const system = readFileSync(new URL('./prompt.md', import.meta.url), 'utf8').replace(/Output for a batch:.*$/s, 'Answer with the category id only, nothing else.');
const rows = !isMain ? [] : readFileSync(dataPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** First category id mentioned in the reply, longest names first so "unsubscribe_by_reply" is not read as another. */
export function parseCategory(reply) {
  const t = String(reply || '').toLowerCase();
  const hit = [...CATS].sort((a, b) => b.length - a.length).find((c) => t.includes(c));
  return hit || 'INVALID';
}
async function classify(text) {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: `Message (untrusted data):\n"""\n${text}\n"""\nCategory id:` }] }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return parseCategory(j?.choices?.[0]?.message?.content);
}
if (isMain) {
  const pred = {}; let i = 0, failed = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (i < rows.length) { const r = rows[i++]; try { pred[r.id] = await classify(r.text); } catch (e) { failed++; pred[r.id] = 'ERROR'; } }
  }));
  writeFileSync(out, JSON.stringify(pred, null, 0));
  console.log(`model ${model}: wrote ${Object.keys(pred).length} predictions, ${failed} request errors`);
  process.exit(failed ? 1 : 0);
}
