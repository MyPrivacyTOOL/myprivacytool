// MPC-11569 / MPC-11622: synthetic fixture profiles for the WEB and EMAIL channels (rules page section 8: at least ten per channel; all-off, default, partial, hardened).
// Each profile is the registry STATUS of every in-scope data point as a scan would report it (`found` / `clear` / `not_checked`), so the adapters are exercised too.
// SYNTHETIC: nobody's real scan. `score` is pinned and worked out by hand from the tier weights (low 1, medium 2, high 3); the test also recomputes it with an independent oracle.
//   web:   total weight 78, always sent 59 (38 fields), settings 19 (9 fields), floor round(100*59/78) = 76.
//   email: total weight 15, always sent 6 (3 fields), settings 9 (3 fields), floor 40.
import { WEB_EXPOSURE } from './web.js';
import { EMAIL_EXPOSURE } from './email.js';

const status = (def, fn) => def.fields.map((f) => ({ id: f.id, status: fn(f) }));
const webSettings = WEB_EXPOSURE.fields.filter((f) => f.group === 'settings').sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : 1));
const webLadder = (k) => { const hidden = new Set(webSettings.slice(0, k).map((f) => f.id)); return status(WEB_EXPOSURE, (f) => (hidden.has(f.id) ? 'not_checked' : 'found')); };
const alwaysWeb = WEB_EXPOSURE.fields.filter((f) => f.group === 'base');

/** Web: W0 all off, W1..W8 partially hardened (the highest-weight setting hardened first), W9 fully hardened (the floor), then three edge profiles. */
export const WEB_FIXTURES = [
  { id: 'W0', name: 'all privacy off', note: 'Every one of the 47 comes back.', items: webLadder(0), expect: { returned: 47, score: 100 } },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({ id: `W${k}`, name: `partially hardened: ${k} of 9 settings`, note: `The ${k} highest-weight settings hardened (their fields come back as not checked).`, items: webLadder(k), expect: { returned: 47 - k, score: [0, 96, 94, 91, 88, 86, 83, 81, 78][k] } })),
  { id: 'W9', name: 'fully hardened: all 9 settings', note: 'Only the 38 always-sent fields come back. This is the floor.', items: webLadder(9), expect: { returned: 38, score: 76 } },
  { id: 'W10', name: 'default browser, 3 always-sent detectors did not return', note: 'Three always-sent fields missing from an otherwise open browser. The platform could not send what the detector could not read.', items: status(WEB_EXPOSURE, (f) => (alwaysWeb.slice(0, 3).some((a) => a.id === f.id) ? 'not_checked' : 'found')), expect: { returned: 44, score: 95 } },
  { id: 'W11', name: 'every check ran, nothing came back', note: 'All 47 reported `clear`: observed, nothing returned. A real score of 0, below the floor.', items: status(WEB_EXPOSURE, () => 'clear'), expect: { returned: 0, score: 0 } },
  { id: 'W12', name: 'nothing produced a result (dead scan)', note: 'No found, no clear: no score. A dead scan is never shown as 0.', items: status(WEB_EXPOSURE, () => 'not_checked'), expect: { status: 'incomplete' } },
];

const emailSet = (ids) => { const s = new Set(ids); return status(EMAIL_EXPOSURE, (f) => (s.has(f.id) ? 'found' : 'clear')); };
const eid = (...k) => k.map((x) => `email-${x}`);
/** Email: found / clear pattern per check. Weights: name 3, provider 1, domain-record 2 (always sent); profile 3, libravatar 3, github-commits 3 (settings). */
export const EMAIL_FIXTURES = [
  { id: 'E1', name: 'all privacy off', note: 'All six checks return something.', items: emailSet(eid('name', 'provider', 'domain-record', 'profile', 'libravatar', 'github-commits')), expect: { returned: 6, score: 100 } },
  { id: 'E2', name: 'partially hardened: no public GitHub commits', note: 'GitHub commit search finds nothing under this address.', items: emailSet(eid('name', 'provider', 'domain-record', 'profile', 'libravatar')), expect: { returned: 5, score: 80 } },
  { id: 'E3', name: 'partially hardened: no GitHub, no Libravatar', note: '', items: emailSet(eid('name', 'provider', 'domain-record', 'profile')), expect: { returned: 4, score: 60 } },
  { id: 'E4', name: 'fully hardened: no Gravatar, Libravatar or GitHub', note: 'Only what the address itself reveals comes back. This is the floor.', items: emailSet(eid('name', 'provider', 'domain-record')), expect: { returned: 3, score: 40 } },
  { id: 'E5', name: 'only the name in the address', note: 'Below the floor: the provider and domain record did not return.', items: emailSet(eid('name')), expect: { returned: 1, score: 20 } },
  { id: 'E6', name: 'only the provider', note: '', items: emailSet(eid('provider')), expect: { returned: 1, score: 7 } },
  { id: 'E7', name: 'only the changeable checks returned', note: 'Gravatar, Libravatar and GitHub return something; the three always-sent checks did not.', items: emailSet(eid('profile', 'libravatar', 'github-commits')), expect: { returned: 3, score: 60 } },
  { id: 'E8', name: 'Gravatar only', note: '', items: emailSet(eid('profile')), expect: { returned: 1, score: 20 } },
  { id: 'E9', name: 'every check ran, nothing came back', note: 'All six answered `clear`. A real score of 0.', items: emailSet([]), expect: { returned: 0, score: 0 } },
  { id: 'E10', name: 'every source unreachable', note: 'All six `not_checked`: nothing observed, no score.', items: status(EMAIL_EXPOSURE, () => 'not_checked'), expect: { status: 'incomplete' } },
  { id: 'E11', name: 'one source unreachable', note: 'Libravatar timed out, the other five answered. A number is never invented from a check that did not run: no score.', items: status(EMAIL_EXPOSURE, (f) => (f.id === 'email-libravatar' ? 'not_checked' : f.id === 'email-name' ? 'found' : 'clear')), expect: { status: 'incomplete' } },
];
