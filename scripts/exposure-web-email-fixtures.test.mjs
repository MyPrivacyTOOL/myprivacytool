// MPC-11569 / MPC-11622: the published web and email fixture table is exactly what the real code produces.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render, OUT } from './exposure-web-email-fixtures.mjs';
assert.equal(readFileSync(OUT, 'utf8'), render(), 'docs/exposure-tier-1-web-email-fixtures.md is stale: run node scripts/exposure-web-email-fixtures.mjs');
console.log('exposure-web-email-fixtures.test.mjs ok');
