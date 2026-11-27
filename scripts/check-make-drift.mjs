#!/usr/bin/env node
// Compares the live Make scenario MPC-6952 (id 7817044) with the reviewed copy in docs/make/mpc-6952-blueprint.json.
// Why: on 2026-10-29 a blueprint update built from a stale copy silently overwrote a fix. Any difference between the live
// scenario and the repo copy means someone changed Make without a pull request (or a PR forgot to update the copy).
//
// Usage:
//   MAKE_API_TOKEN=... node scripts/check-make-drift.mjs            compare live with the repo copy (exit 1 on drift)
//   node scripts/check-make-drift.mjs --file other.json             compare a local JSON file instead of the live scenario
// Optional env: MAKE_ZONE (default eu1), MAKE_SCENARIO_ID (default 7817044).
// The token is only sent as an Authorization header and is never printed. Editor-only layout data (metadata.designer) and
// the receipt token value are ignored, so moving a box in the Make editor is not drift.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const RECEIPT_TOKEN_PLACEHOLDER = '__RECEIPT_TOKEN__';
const REPO_COPY = new URL('../docs/make/mpc-6952-blueprint.json', import.meta.url);

/** Keeps only what defines behaviour: name, scenario settings and the module flow; drops editor layout; masks the shared secret. */
export function normalize(bp) {
  const clean = (v, key) => {
    if (Array.isArray(v)) return v.map((x) => clean(x));
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'designer').map(([k, x]) => [k, clean(x, k)]));
    }
    return v;
  };
  const maskTokens = (v) => {
    if (Array.isArray(v)) return v.map(maskTokens);
    if (v && typeof v === 'object') {
      if (v.name === 'x-receipt-token' && 'value' in v) return { ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskTokens(x)])), value: RECEIPT_TOKEN_PLACEHOLDER };
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskTokens(x)]));
    }
    return v;
  };
  return maskTokens(clean({ name: bp.name, metadata: bp.metadata, flow: bp.flow }));
}

/** Path-level differences between two JSON values, e.g. "flow[1].routes[1].flow[1].routes[0].flow[0].mapper.serializeUrl: missing in live". */
export function diff(expected, live, path = '') {
  if (JSON.stringify(expected) === JSON.stringify(live)) return [];
  const here = path || '(root)';
  const isObj = (v) => v && typeof v === 'object';
  if (!isObj(expected) || !isObj(live) || Array.isArray(expected) !== Array.isArray(live)) {
    return [`${here}: repo ${JSON.stringify(expected)} vs live ${JSON.stringify(live)}`];
  }
  if (Array.isArray(expected)) {
    const out = [];
    for (let i = 0; i < Math.max(expected.length, live.length); i++) {
      const p = `${path}[${i}]`;
      if (i >= live.length) out.push(`${p}: in repo copy, missing in live`);
      else if (i >= expected.length) out.push(`${p}: in live, missing in repo copy`);
      else out.push(...diff(expected[i], live[i], p));
    }
    return out;
  }
  const out = [];
  for (const k of new Set([...Object.keys(expected), ...Object.keys(live)])) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in live)) out.push(`${p}: in repo copy, missing in live`);
    else if (!(k in expected)) out.push(`${p}: in live, missing in repo copy`);
    else out.push(...diff(expected[k], live[k], p));
  }
  return out;
}

/** The Make API wraps the blueprint as { response: { blueprint } }; accept the bare blueprint too. */
export const unwrap = (body) => body?.response?.blueprint ?? body?.blueprint ?? body;

export async function fetchLive({ token, zone = 'eu1', scenarioId = '7817044' }, fetchImpl = fetch) {
  const res = await fetchImpl(`https://${zone}.make.com/api/v2/scenarios/${scenarioId}/blueprint`, { headers: { Authorization: `Token ${token}` } });
  if (!res.ok) throw new Error(`Make API answered ${res.status}`);
  return unwrap(await res.json());
}

export async function main(env = process.env, argv = process.argv, fetchImpl = fetch, log = console.log) {
  const fileIdx = argv.indexOf('--file');
  const expected = normalize(JSON.parse(readFileSync(REPO_COPY, 'utf8')));
  let live;
  if (fileIdx >= 0) live = JSON.parse(readFileSync(argv[fileIdx + 1], 'utf8'));
  else {
    if (!env.MAKE_API_TOKEN) throw new Error('MAKE_API_TOKEN is not set');
    live = await fetchLive({ token: env.MAKE_API_TOKEN, zone: env.MAKE_ZONE || 'eu1', scenarioId: env.MAKE_SCENARIO_ID || '7817044' }, fetchImpl);
  }
  const problems = diff(expected, normalize(unwrap(live)));
  if (!problems.length) { log('No drift: the live Make scenario matches docs/make/mpc-6952-blueprint.json'); return 0; }
  log(`DRIFT: ${problems.length} difference(s) between the live Make scenario and docs/make/mpc-6952-blueprint.json`);
  for (const p of problems.slice(0, 40)) log(` - ${p}`);
  if (problems.length > 40) log(` ... and ${problems.length - 40} more`);
  log('Fix: if the live change is intended, update the repo copy in a pull request (docs/make/README.md); if not, restore the scenario from the copy.');
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(2); });
}
