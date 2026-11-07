// Scores a classifier's predictions against labels.json. Usage: node score.mjs <predictions.json> [labels.json]
// predictions.json = {"T001": "spam", ...}. Prints overall accuracy, per-category recall, the confusions, and the SAFETY metric:
// a data_request or unsubscribe_by_reply message must never be filed as anything that could be auto-answered or ignored. A miss there is "unsafe".
import { readFileSync } from 'node:fs';
const [,, predPath, labelPath = new URL('./labels.json', import.meta.url).pathname] = process.argv;
if (!predPath) { console.error('usage: node score.mjs <predictions.json> [labels.json]'); process.exit(2); }
const labels = JSON.parse(readFileSync(labelPath, 'utf8'));
const pred = JSON.parse(readFileSync(predPath, 'utf8'));
const CATS = ['support', 'complaint', 'unsubscribe_by_reply', 'partner', 'sales_reply', 'data_request', 'spam'];
const ids = Object.keys(labels);
const missing = ids.filter((id) => !(id in pred));
const invalid = ids.filter((id) => id in pred && !CATS.includes(pred[id]));
let ok = 0; const per = Object.fromEntries(CATS.map((c) => [c, { n: 0, hit: 0 }])); const conf = {}; const unsafe = [];
for (const id of ids) {
  const t = labels[id], p = pred[id]; per[t].n++;
  if (p === t) { ok++; per[t].hit++; } else { const k = `${t} -> ${p ?? 'MISSING'}`; conf[k] = (conf[k] || 0) + 1; if (t === 'data_request' || t === 'unsubscribe_by_reply') unsafe.push(`${id} (${t} -> ${p ?? 'MISSING'})`); }
}
console.log(`messages: ${ids.length}  missing: ${missing.length}  invalid category: ${invalid.length}`);
console.log(`accuracy: ${ok}/${ids.length} = ${(100 * ok / ids.length).toFixed(1)}%`);
for (const c of CATS) console.log(`  ${c.padEnd(22)} ${per[c].hit}/${per[c].n}`);
// Show every miss with its text so the prompt can be tightened from facts (the set is synthetic, so printing it is safe).
const texts = Object.fromEntries(readFileSync(new URL('./dataset.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.id, r.text]));
for (const id of ids) if (pred[id] !== labels[id]) console.log(`  MISS ${id}: ${labels[id]} -> ${pred[id] ?? 'MISSING'} | ${texts[id] ?? ''}`);
console.log('confusions:', Object.entries(conf).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} x${v}`).join('; ') || 'none');
console.log(`SAFETY (data_request / unsubscribe_by_reply that were NOT filed correctly): ${unsafe.length}${unsafe.length ? '  ' + unsafe.join(', ') : ''}`);
process.exit(missing.length || invalid.length ? 1 : 0);
