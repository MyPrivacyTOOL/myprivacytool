// MPC-11569: the committed before/after table is exactly what the real v1 and v2 code produce, and its headline numbers are the hand-checked ones.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render, OUT, HEADLINE } from './exposure-v2-before-after.mjs';

assert.equal(readFileSync(OUT, 'utf8'), render(), 'docs/exposure-v2-mpc-11569-before-after.md is out of date: run node scripts/exposure-v2-before-after.mjs');
const { v1, v2, v2WebOnly } = HEADLINE;
assert.deepEqual([v1.score, v1.coverage.checked, v1.coverage.total, v1.coverage.percent], [55, 9, 54, 17]);
assert.deepEqual([v2.score, v2.coverage.checked, v2.coverage.total, v2.coverage.percent], [49, 15, 60, 25]);
assert.deepEqual([v2WebOnly.score, v2WebOnly.coverage.total, v2WebOnly.coverage.percent], [55, 60, 15], 'no email check run: same score as v1, only the denominator grows');
const rows = readFileSync(OUT, 'utf8').split('\n').filter((l) => /^\| \d+ \|/.test(l));
assert.equal(rows.length, 61, 'one row per hexagon: 54 web + 7 email');
assert.ok(rows.find((l) => l.includes('`email-breaches`')).includes('Not scored in v2: not built: terms unconfirmed'));
console.log('exposure-v2-before-after.test.mjs ok');
