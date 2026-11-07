// Tests run-model.mjs against a local mock chat endpoint (no network, no key) and score.mjs. Run: node scripts/triage-eval/run-model.test.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCategory } from './run-model.mjs';

let failed = 0; const check = (ok, m) => { console.log(ok ? 'PASS' : 'FAIL', m); if (!ok) failed++; };
const here = (f) => new URL(f, import.meta.url).pathname;
const labels = JSON.parse(readFileSync(here('./labels.json'), 'utf8'));
const rows = readFileSync(here('./dataset.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byText = Object.fromEntries(rows.map((r) => [r.text, labels[r.id]]));

check(parseCategory('unsubscribe_by_reply') === 'unsubscribe_by_reply', 'parse: the longest category name wins');
check(parseCategory('I think this is a Partner.') === 'partner', 'parse: case-insensitive, found inside a sentence');
check(parseCategory('no idea') === 'INVALID' && parseCategory(undefined) === 'INVALID', 'parse: anything else is INVALID, never guessed');

const run = (cmd, args, env = {}) => new Promise((resolve) => {
  const p = spawn(cmd, args, { env: { ...process.env, ...env } }); let out = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d)); p.on('close', (code) => resolve({ code, out }));
});
let flakyHit = false;
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => (b += d));
  req.on('end', () => {
    const user = JSON.parse(b).messages[1].content; const text = user.split('"""\n')[1].replace(/\n$/, '');
    const label = byText[text];
    if (!flakyHit && label === 'support') { flakyHit = true; res.statusCode = 500; res.end('boom'); return; }   // one transient failure: the runner must retry it
    const answer = label === 'partner' ? 'I think this is partner.' : label === 'spam' ? 'support' : label;   // mock gets every spam wrong
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
  });
});
await new Promise((r) => srv.listen(0, r));
const out = join(mkdtempSync(join(tmpdir(), 'triage-')), 'pred.json');
const r = await run('node', [here('./run-model.mjs'), out], { QWEN_API_KEY: 'x', QWEN_BASE_URL: `http://127.0.0.1:${srv.address().port}` });
check(r.code === 0 && /wrote 100 predictions, 0 request errors/.test(r.out), 'runner: 100 predictions written, no request errors');
const s = await run('node', [here('./score.mjs'), out]);
check(/accuracy: 86\/100/.test(s.out) && /spam\s+0\/14/.test(s.out), 'scorer: the mock that misses all 14 spam scores exactly 86/100');
const noKey = await run('node', [here('./run-model.mjs'), out], { QWEN_API_KEY: '' });
check(noKey.code === 2, 'runner: refuses to run without QWEN_API_KEY');
srv.close();
console.log(failed ? `${failed} FAILED` : 'ALL PASS'); process.exit(failed ? 1 : 0);
