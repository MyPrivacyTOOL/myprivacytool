// Scores the yes/no check. Usage: node score-flag.mjs <flags.json> [flag-set.json]
// RECALL on messages that should be "yes" is the number that matters (a miss is an opt-out or data request that could be ignored); false "yes" only costs a person a look.
// ERROR and INVALID answers count as "yes" (they would reach a person) and are reported separately.
import { readFileSync } from 'node:fs';
const [,, flagsPath, setPath = new URL('./flag-set.json', import.meta.url).pathname] = process.argv;
if (!flagsPath) { console.error('usage: node score-flag.mjs <flags.json> [flag-set.json]'); process.exit(2); }
const flags = JSON.parse(readFileSync(flagsPath, 'utf8'));
const items = JSON.parse(readFileSync(setPath, 'utf8'));
const raised = (id) => flags[id] !== 'no';   // missing, ERROR, INVALID and "yes" all reach a person
const by = {}; const misses = []; let errors = 0, invalid = 0, missing = 0;
for (const it of items) {
  const f = flags[it.id];
  if (f === undefined) missing++; else if (f === 'ERROR') errors++; else if (f === 'INVALID') invalid++;
  const s = (by[it.set] ||= { pos: 0, caught: 0, neg: 0, raised: 0 });
  if (it.positive) { s.pos++; if (raised(it.id)) s.caught++; else misses.push(`${it.id} | ${it.text}`); } else { s.neg++; if (raised(it.id)) s.raised++; }
}
const tot = Object.values(by).reduce((a, s) => ({ pos: a.pos + s.pos, caught: a.caught + s.caught, neg: a.neg + s.neg, raised: a.raised + s.raised }), { pos: 0, caught: 0, neg: 0, raised: 0 });
console.log(`answers: ${items.length}  missing: ${missing}  request errors: ${errors}  unreadable: ${invalid} (errors and unreadable count as yes)`);
for (const [set, s] of Object.entries(by)) console.log(`  ${set.padEnd(6)} should-be-yes caught ${s.caught}/${s.pos}   ordinary messages raised ${s.raised}/${s.neg}`);
console.log(`RECALL ${tot.caught}/${tot.pos} = ${(100 * tot.caught / tot.pos).toFixed(1)}%   ordinary messages raised to a person: ${tot.raised}/${tot.neg} = ${(100 * tot.raised / tot.neg).toFixed(1)}%`);
for (const m of misses) console.log(`  MISSED (answered no): ${m}`);
process.exit(missing ? 1 : 0);
