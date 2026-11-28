// MPC-11569: the synthetic profiles for exposure-v3 (rules page section 8: at least ten per channel, all privacy off / default / partially hardened / fully hardened).
// One channel per profile (the score is within-channel only). A profile is the status of EVERY in-scope data point: 'found' (it came back), 'clear' (the check ran, nothing came back), 'not_checked' (it did not run). Synthetic only.
import { scopeFor } from './scoreV3.js';

const web = scopeFor('web');
const em = scopeFor('email');
const build = (rows, fn) => rows.map((r) => ({ id: r.id, status: fn(r) }));
const pts = (r) => r.tier; // hardening order: highest tier first, then id, so every ladder is deterministic
const changeableWeb = web.filter((r) => r.changeable).sort((a, b) => pts(b) - pts(a) || (a.id < b.id ? -1 : 1));

/** Web ladder W0..W9: W0 = everything returned (all privacy off); each step hardens the next-highest-tier changeable field; W9 = every changeable field hardened (the floor). */
export const WEB_PROFILES = [];
for (let k = 0; k <= changeableWeb.length; k++) {
  const hardened = new Set(changeableWeb.slice(0, k).map((r) => r.id));
  const name = k === 0 ? 'W0 all privacy off' : k === changeableWeb.length ? `W${k} fully hardened (all ${k} changeable fields hardened)` : `W${k} partially hardened (${k} of ${changeableWeb.length} changeable fields)`;
  WEB_PROFILES.push({ name, channel: 'web', items: build(web, (r) => (hardened.has(r.id) ? 'clear' : 'found')) });
}
const alwaysWeb = web.filter((r) => !r.changeable);
WEB_PROFILES.push({ name: `W${changeableWeb.length + 1} default browser, 3 always-sent detectors failed to run`, channel: 'web', items: build(web, (r) => (r.id === alwaysWeb[0].id || r.id === alwaysWeb[1].id || r.id === alwaysWeb[2].id ? 'not_checked' : 'found')) });
WEB_PROFILES.push({ name: `W${changeableWeb.length + 2} every check ran and nothing came back`, channel: 'web', items: build(web, () => 'clear') });
WEB_PROFILES.push({ name: `W${changeableWeb.length + 3} nothing ran (all detectors failed)`, channel: 'web', items: build(web, () => 'not_checked') });

const E = (names) => new Set(names);
const emailSets = [
  ['E1 all privacy off', E(em.map((r) => r.id))],
  ['E2 no GitHub commits under this address', E(em.map((r) => r.id).filter((i) => i !== 'email-github-commits'))],
  ['E3 no GitHub, no Libravatar', E(em.map((r) => r.id).filter((i) => !['email-github-commits', 'email-libravatar'].includes(i)))],
  ['E4 fully hardened (no Gravatar, Libravatar or GitHub)', E(em.filter((r) => !r.changeable).map((r) => r.id))],
  ['E5 only the address itself (name)', E(['email-name'])],
  ['E6 only the provider', E(['email-provider'])],
  ['E7 only changeable fields came back (no name, provider or domain record)', E(em.filter((r) => r.changeable).map((r) => r.id))],
  ['E8 Gravatar only', E(['email-profile'])],
  ['E9 every check ran and nothing came back', E([])],
];
export const EMAIL_PROFILES = emailSets.map(([name, set]) => ({ name, channel: 'email', items: build(em, (r) => (set.has(r.id) ? 'found' : 'clear')) }));
EMAIL_PROFILES.push({ name: 'E10 nothing ran (all checks failed)', channel: 'email', items: build(em, () => 'not_checked') });
