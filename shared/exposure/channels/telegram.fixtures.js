// MPC-11622: the Telegram fixture table. SYNTHETIC profiles: nobody's real account, and not a measurement of what Telegram really returns by default.
// Each profile lists the fields (of the 25 in scope) that came back. `expect` is worked out BY HAND from the tier weights (low 1, medium 2, high 3)
// and pinned here, so a change to a tier, the scope or the formula fails the test instead of silently moving every user's number.
//   always-sent fields (weight): numeric_id 2, first_name 3, last_name 3, username 3, language 2, message_time 2, message_text 2, update_counter 1  = 18
//   settings fields (weight): bio 2, birthday 3, photo_current 3, photo_history 3, photo_fingerprint 2, extra_usernames 3, premium 2, emoji_status 1,
//     profile_colour 2, profile_background 2, gift_settings 1, business_intro 1, business_location 3, business_hours 1, personal_channel 2,
//     forward_privacy 2, voice_restriction 1  = 34.   Total 52. Floor = round(100 * 18 / 52) = 35.
import { scoreTelegram } from './telegram.js';
import { TELEGRAM_EXPOSURE } from './telegram.js';

const tg = (...keys) => keys.map((k) => `tg.${k}`);
export const ALWAYS_SENT = tg('numeric_id', 'first_name', 'last_name', 'username', 'language', 'message_time', 'message_text', 'update_counter');
const without = (list, ...keys) => list.filter((id) => !keys.map((k) => `tg.${k}`).includes(id));

/** found = tier weight of returned fields; score = round_half_up(100 * found / 52); position = (score - 35) / 65, clamped at 0 below the floor. */
export const FIXTURES = [
  { id: 'P01', name: 'all-off', note: 'Every setting hides everything it can; only the always-sent fields come back. This is the floor.',
    returned: [...ALWAYS_SENT], expect: { returned: 8, found: 18, score: 35, position: 0, belowFloor: false } },
  { id: 'P02', name: 'all-off, no last name', note: 'As P01, but the account never set a last name. The platform cannot send what is not there, so this sits below the floor.',
    returned: without(ALWAYS_SENT, 'last_name'), expect: { returned: 7, found: 15, score: 29, position: 0, belowFloor: true } },
  { id: 'P03', name: 'all-off, no last name, no username', note: 'As P01, but neither a last name nor a username was ever set.',
    returned: without(ALWAYS_SENT, 'last_name', 'username'), expect: { returned: 6, found: 12, score: 23, position: 0, belowFloor: true } },
  { id: 'P04', name: 'default-like: one public photo', note: 'Always-sent fields plus one public profile photo and its fingerprint. Nothing else set.',
    returned: [...ALWAYS_SENT, ...tg('photo_current', 'photo_fingerprint')], expect: { returned: 10, found: 23, score: 44, position: 14, belowFloor: false } },
  { id: 'P05', name: 'default-like: three public photos', note: 'As P04 with older photos too.',
    returned: [...ALWAYS_SENT, ...tg('photo_current', 'photo_history', 'photo_fingerprint')], expect: { returned: 11, found: 26, score: 50, position: 23, belowFloor: false } },
  { id: 'P06', name: 'partial: profile text exposed', note: 'Bio, birthday and extra @usernames come back; the rest hidden.',
    returned: [...ALWAYS_SENT, ...tg('bio', 'birthday', 'extra_usernames')], expect: { returned: 11, found: 26, score: 50, position: 23, belowFloor: false } },
  { id: 'P07', name: 'partial: business profile exposed', note: 'Business intro, address, hours and a personal channel come back.',
    returned: [...ALWAYS_SENT, ...tg('business_intro', 'business_location', 'business_hours', 'personal_channel')], expect: { returned: 12, found: 25, score: 48, position: 20, belowFloor: false } },
  { id: 'P08', name: 'unit-test profile (baseline-scan.vitest.ts CHAT)', note: 'The profile the Telegram unit tests use: no last name; username, bio, birthday, photo and its fingerprint returned.',
    returned: [...without(ALWAYS_SENT, 'last_name'), ...tg('bio', 'birthday', 'photo_current', 'photo_fingerprint')], expect: { returned: 11, found: 25, score: 48, position: 20, belowFloor: false } },
  { id: 'P09', name: 'owner example: 14 returned', note: 'Constructed to match the rules page example (14 fields returned, exposure 62): four high-tier and two low-tier settings come back. The old method read 14 of 30 = 47%.',
    returned: [...ALWAYS_SENT, ...tg('birthday', 'photo_current', 'photo_history', 'extra_usernames', 'emoji_status', 'gift_settings')], expect: { returned: 14, found: 32, score: 62, position: 42, belowFloor: false } },
  { id: 'P10', name: 'hardened: only two minor settings leak', note: 'Forwarding privacy and the voice restriction come back; everything else hidden.',
    returned: [...ALWAYS_SENT, ...tg('forward_privacy', 'voice_restriction')], expect: { returned: 10, found: 21, score: 40, position: 8, belowFloor: false } },
  { id: 'P11', name: 'fully exposed', note: 'Every one of the 25 fields comes back.',
    returned: TELEGRAM_EXPOSURE.fields.map((f) => f.id), expect: { returned: 25, found: 52, score: 100, position: 100, belowFloor: false } },
  { id: 'P12', name: 'only the high-tier settings exposed', note: 'Birthday, photos, extra @usernames and business address come back; every medium and low setting hidden.',
    returned: [...ALWAYS_SENT, ...tg('birthday', 'photo_current', 'photo_history', 'extra_usernames', 'business_location')], expect: { returned: 13, found: 33, score: 63, position: 43, belowFloor: false } },
  { id: 'P13', name: 'only the low-tier settings exposed', note: 'Emoji status, gift settings, business intro, business hours and the voice restriction come back; everything else hidden.',
    returned: [...ALWAYS_SENT, ...tg('emoji_status', 'gift_settings', 'business_intro', 'business_hours', 'voice_restriction')], expect: { returned: 13, found: 23, score: 44, position: 14, belowFloor: false } },
];

/** Observations for a fixture: every in-scope field is observed, returned or not. */
export const observationsOf = (fx) => TELEGRAM_EXPOSURE.fields.map((f) => ({ id: f.id, state: fx.returned.includes(f.id) ? 'returned' : 'not_returned' }));

/** The published fixture table (markdown), generated from the live scorer. The test checks docs/exposure-tier-1-telegram-fixtures.md contains exactly this. */
export function fixtureTable() {
  const head = '| # | Profile | Fields returned | Weight found / 52 | Exposure | Position in range | Fix list total |\n|---|---|---|---|---|---|---|';
  const rows = FIXTURES.map((fx) => {
    const r = scoreTelegram(observationsOf(fx));
    const pos = r.position.belowFloor ? '0% (below floor)' : `${r.position.percent}%`;
    return `| ${fx.id} | ${fx.name} | ${r.countText} | ${r.weight.found} | ${r.score} | ${pos} | ${r.recoverable.text} |`;
  });
  return [head, ...rows].join('\n');
}
