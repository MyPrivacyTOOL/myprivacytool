// Tests run-flag.mjs and score-flag.mjs against a local mock endpoint (no network, no key). Run: node scripts/triage-eval/run-flag.test.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFlag } from './run-flag.mjs';

let failed = 0; const check = (ok, m) => { console.log(ok ? 'PASS' : 'FAIL', m); if (!ok) failed++; };
const here = (f) => new URL(f, import.meta.url).pathname;
const items = JSON.parse(readFileSync(here('./flag-set.json'), 'utf8'));
const byText = Object.fromEntries(items.map((i) => [i.text, i]));
check(items.length === 200 && items.filter((i) => i.positive).length === 81, 'flag set: 200 synthetic messages, 81 should be yes');
check(parseFlag('Yes.') === 'yes' && parseFlag('NO') === 'no' && parseFlag('maybe') === 'INVALID' && parseFlag(undefined) === 'INVALID', 'parse: yes/no found, anything else INVALID');

const run = (cmd, args, env = {}) => new Promise((resolve) => { const p = spawn(cmd, args, { env: { ...process.env, ...env } }); let o = ''; p.stdout.on('data', (d) => (o += d)); p.stderr.on('data', (d) => (o += d)); p.on('close', (code) => resolve({ code, out: o })); });
let flaky = false;
const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
  const text = JSON.parse(b).messages[1].content.split('"""\n')[1].replace(/\n$/, ''); const it = byText[text];
  if (!flaky && it?.positive) { flaky = true; res.statusCode = 500; res.end('boom'); return; }   // one transient failure: must be retried
  const answer = it?.set === 'fresh3' && it.positive ? 'no' : it?.positive ? 'Yes.' : 'no';   // the mock misses every positive of fresh3 (15)
  res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
}); });
await new Promise((r) => srv.listen(0, r));
const out = join(mkdtempSync(join(tmpdir(), 'flag-')), 'flags.json');
const r = await run('node', [here('./run-flag.mjs'), out], { QWEN_API_KEY: 'x', QWEN_BASE_URL: `http://127.0.0.1:${srv.address().port}` });
check(r.code === 0 && /wrote 200 answers, 0 request errors/.test(r.out), 'runner: 200 answers, the transient 500 was retried');
const s = await run('node', [here('./score-flag.mjs'), out]);
check(/RECALL 66\/81/.test(s.out) && /fresh3 +should-be-yes caught 0\/15/.test(s.out) && /MISSED/.test(s.out), 'scorer: a mock that misses all 15 fresh3 positives scores recall 66/81 and lists the misses');
check((await run('node', [here('./run-flag.mjs'), out], { QWEN_API_KEY: '' })).code === 2, 'runner: refuses to run without QWEN_API_KEY');
srv.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
