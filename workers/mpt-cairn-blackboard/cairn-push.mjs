// Pushes a Cairn run (MPC-8402 schema) to the mpt-cairn-blackboard Worker (MPC-8413). This is the "Cairn worker implementation" the integration spec
// asks for: Cairn itself has no setting for an HTTP target, so this script takes a snapshot of its facts and intents and sends them to the bridge.
//   node cairn-push.mjs snapshot.json            (or pipe the JSON on stdin with "-")
// Snapshot shape (what Cairn's API returns): { "facts": [{id, description}], "intents": [{id, from[], to|null, description, creator, worker|null, created_at, concluded_at|null}] }
// Settings (environment): CAIRN_TOKEN (the bridge token), SEED_EMAIL (who the investigation is about), BRIDGE_URL (optional),
//   SESSION_ID (optional, mpt-cairn-<digits>; default is derived from the earliest intent so a re-push of the same run lands in the same session),
//   INVESTIGATION_GOAL, CAIRN_PROJECT_ID (optional).
// Safe to re-run: the bridge ignores facts and intents it already has. Prints counts only, never a fact, the seed email or the token.
import { readFileSync } from 'node:fs';

const DEFAULT_URL = 'https://mpt-cairn-blackboard.myprivacytool.workers.dev';
const BATCH = 10; // the bridge allows 25 per call and 30 writes a minute per session; small batches plus a pause stay well under both
const PAUSE_MS = 25000;

const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;
// Missing a phone number would leave it readable in the description, so this errs towards catching: only IPv4 addresses and ISO dates are excluded.
const findPhone = (text) => [...text.matchAll(PHONE_RE)].map((m) => m[0].trim()).find((c) => !/^\d{1,3}(\.\d{1,3}){3}$/.test(c) && !/^\d{4}-\d{2}-\d{2}$/.test(c) && c.replace(/\D/g, '').length >= 8);
const EMAIL_RE = /[^\s@<>"']{1,64}@[^\s@<>"']{1,255}\.[A-Za-z]{2,}/;

const safeId = (prefix, id) => `${prefix}-${String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64).padEnd(3, '_')}`;

// Cairn facts are free text with no type. A phone number or an email address is pulled out as the fact value so the bridge can hash a phone
// before it is stored (and masks it in the description). Anything else is kept as a public_record, which is the cautious (High risk) default.
export function mapFact(f, intents) {
  const description = String(f.description ?? '').trim();
  const phone = findPhone(description);
  const email = description.match(EMAIL_RE)?.[0];
  const source = intents.find((i) => i.to === f.id);
  const out = {
    fact_id: safeId('cairn-fact', f.id),
    description: description || '(empty)',
    fact_type: phone ? 'phone' : email ? 'email' : 'public_record',
    data_classification: 'sensitive',
  };
  if (phone) out.fact_value = phone; else if (email) out.fact_value = email;
  if (source) {
    out.discovered_from_intent_id = safeId('cairn-intent', source.id);
    out.discovery_chain = [...(source.from ?? []).map((x) => safeId('cairn-fact', x)), safeId('cairn-intent', source.id)];
  }
  return out;
}

export function mapIntent(i) {
  return {
    intent_id: safeId('cairn-intent', i.id),
    description: String(i.description ?? '').trim() || '(empty)',
    intent_type: i.worker ?? null,
    from_fact_ids: (i.from ?? []).map((x) => safeId('cairn-fact', x)),
    target_fact_id: i.to ? safeId('cairn-fact', i.to) : null,
    creator: i.creator ?? null,
  };
}

export const sessionIdFor = (snapshot) => {
  const times = (snapshot.intents ?? []).map((i) => Date.parse(i.created_at)).filter(Number.isFinite);
  const seconds = Math.floor((times.length ? Math.min(...times) : Date.now()) / 1000);
  return `mpt-cairn-${seconds}`;
};

const chunk = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, k) => list.slice(k * n, k * n + n));

export async function push(snapshot, env, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), pauseMs = PAUSE_MS } = {}) {
  if (!env.CAIRN_TOKEN) throw new Error('CAIRN_TOKEN is not set');
  if (!env.SEED_EMAIL) throw new Error('SEED_EMAIL is not set');
  const base = (env.BRIDGE_URL || DEFAULT_URL).replace(/\/$/, '');
  const facts = Array.isArray(snapshot.facts) ? snapshot.facts : [];
  const intents = Array.isArray(snapshot.intents) ? snapshot.intents : [];
  if (!facts.length && !intents.length) throw new Error('the snapshot has no facts or intents');
  const sessionId = env.SESSION_ID || sessionIdFor(snapshot);
  let sent = 0;

  async function commit(action, payload) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`${base}/api/cairn/blackboard/commit`, {
        method: 'POST',
        headers: { authorization: `Bearer ${env.CAIRN_TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, action, payload }),
      });
      if (res.status === 429 || res.status >= 500) { await sleep(Number(res.headers.get('retry-after') || 30) * 1000); continue; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${action} -> HTTP ${res.status} ${body.error ?? ''}`.trim());
      return body;
    }
    throw new Error(`${action} kept failing after 4 tries`);
  }

  await commit('start_session', {
    seed_email: env.SEED_EMAIL,
    investigation_goal: env.INVESTIGATION_GOAL || undefined,
    cairn_project_id: env.CAIRN_PROJECT_ID || undefined,
    max_facts: 100,
  });

  const out = { session_id: sessionId, facts_written: 0, intents_written: 0 };
  const pause = async () => { if (sent++ > 0) await sleep(pauseMs); };
  for (const part of chunk(facts.map((f) => mapFact(f, intents)), BATCH)) {
    await pause();
    const r = await commit('write_facts', { facts: part });
    out.facts_written += r.facts_written ?? 0;
  }
  for (const part of chunk(intents.map(mapIntent), BATCH)) {
    await pause();
    const r = await commit('write_intents', { intents: part });
    out.intents_written += r.intents_written ?? 0;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const src = process.argv[2];
    if (!src) throw new Error('usage: node cairn-push.mjs snapshot.json   (or "-" to read stdin)');
    const snapshot = JSON.parse(readFileSync(src === '-' ? 0 : src, 'utf8'));
    const r = await push(snapshot, process.env);
    console.log(`pushed session ${r.session_id}: ${r.facts_written} new fact(s), ${r.intents_written} new intent(s)`);
  } catch (e) {
    console.error(`cairn-push failed: ${e.message}`);
    process.exit(1);
  }
}
