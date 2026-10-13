// MPC-7645: server-side A/B tests across the referral funnel (email cannot be split in the browser). Each test is OFF unless its switch is exactly "true",
// then everyone gets 'control' and nothing is recorded. The variant is derived from a hash of a stable seed, so a person always gets the same one,
// and it is stored (users.referral_block_variant, referrals.invite_variant) so results are counted from the database. Read them in docs/ab-testing.md.
import { emailHash } from './suppression.js';

export const AB_TESTS = {
  report_block: { env: 'REFERRAL_AB_REPORT_BLOCK', variants: ['control', 'friend_first'] },        // wording of the invite block in the report email
  invite_subject: { env: 'REFERRAL_AB_INVITE_SUBJECT', variants: ['control', 'specific_subject'] }, // subject line of the invitation to the friend
};
export const abOn = (env, id) => env[AB_TESTS[id].env] === 'true';
export async function abVariant(env, id, seed) {
  if (!abOn(env, id)) return 'control';
  const { variants } = AB_TESTS[id];
  return variants[parseInt((await emailHash(`${id}:${seed}`)).slice(0, 8), 16) % variants.length];
}
export const isVariant = (id, v) => AB_TESTS[id].variants.includes(v);
