// MPC-11569: prints the before/after table for the 7 email hexagons (same fixture input, exposure-v1 vs exposure-v2).
//   node scripts/exposure-v2-before-after.mjs            observed statuses (what production returned)
//   node scripts/exposure-v2-before-after.mjs --if-found every email check found something
import { beforeAfterRows, EMAIL_OBSERVED, EMAIL_IF_FOUND } from '../shared/hexagon-registry/score-v2.fixtures.mjs';

const ifFound = process.argv.includes('--if-found');
const rows = beforeAfterRows(ifFound ? EMAIL_IF_FOUND : EMAIL_OBSERVED);
const why = (r) => {
  if (r.id === 'no email result') return 'no email check ran: same score; coverage falls because Z is 61, not 54';
  if (r.id === 'ALL 7 together') return 'v1 ignores all seven; v2 scores six of them, breaches is never checked';
  if (r.id === 'email-breaches') return 'v1: unknown id, ignored. v2: in the 61 but never checked (not built), so score is unchanged and only Z grows';
  const d = r.v2.score - r.v1.score;
  return `v1: unknown id, ignored. v2: counted in the email category (${r.status}); score ${d > 0 ? '+' : ''}${d} because the email category joins the weighted mean`;
};
console.log(`| Fixture | Email check (status) | v1 score / band / coverage | v2 score / band / coverage | Why it differs |`);
console.log(`|---|---|---|---|---|`);
for (const r of rows) {
  console.log(`| ${r.fixture} | ${r.id}${r.status && r.status !== '-' && r.status !== 'all' ? ` (${r.status})` : ''} | ${r.v1.score} / ${r.v1.band} / ${r.v1.coverage} | ${r.v2.score} / ${r.v2.band} / ${r.v2.coverage} | ${why(r)} |`);
}
