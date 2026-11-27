// MPC-11569 (Telegram): the committed before/after table is exactly what the real code produces, and its headline numbers are the hand-checked ones.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from './exposure-v2-telegram-before-after.mjs';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/exposure-v2-mpc-11569-telegram-before-after.md');
const have = readFileSync(OUT, 'utf8');
assert.equal(have, render(), 'docs/exposure-v2-mpc-11569-telegram-before-after.md is out of date: run node scripts/exposure-v2-telegram-before-after.mjs');
assert.ok(have.includes('| owner test snapshot (2026-11-02) | 14 of 30 / 47% / medium | 62 / medium | 25 of 25 (100%) |'));
assert.ok(have.includes('| worst account (all 25 returned) | 25 of 30 / 83% / high | 100 / high |'));
assert.equal(have.split('\n').filter((l) => /^\| tg\./.test(l)).length, 30, 'one row per Telegram hexagon');
assert.equal(have.split('\n').filter((l) => /^\| tg\..*\| not scored \|/.test(l)).length, 5);
console.log('exposure-v2-telegram-before-after.test.mjs ok');
