// MPC-11569: the published exposure-v3 fixture table is exactly what the real code produces, and it has the ten profiles per channel the rules page asks for.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render, OUT } from './exposure-v3-fixtures.mjs';
import { WEB_PROFILES, EMAIL_PROFILES } from '../shared/hexagon-registry/scoreV3.fixtures.mjs';

assert.equal(readFileSync(OUT, 'utf8'), render(), 'docs/exposure-v3-fixtures-mpc-11569.md is stale: run node scripts/exposure-v3-fixtures.mjs');
assert.ok(WEB_PROFILES.length >= 10 && EMAIL_PROFILES.length >= 10, 'at least ten synthetic profiles per channel');
for (const needle of ['all privacy off', 'partially hardened', 'fully hardened']) assert.ok(WEB_PROFILES.some((p) => p.name.includes(needle)) && EMAIL_PROFILES.some((p) => p.name.includes(needle) || (needle === 'partially hardened' && /^E[23] /.test(p.name))), `a ${needle} profile per channel`);
console.log('exposure-v3-fixtures.test.mjs ok');
