// MPC-7891: channel hexagons. One list per messaging channel, kept OUTSIDE the 54 web scan hexagons in registry.js (like EMAIL_HEXAGONS),
// so the web counts, score and tests do not change. Every channel hexagon carries a channel CODE in its id and a `channel` field, so a photo,
// a number or a name that comes back can always be traced to the tool it came from (Telegram "TG", WhatsApp "WA" when built).
//
// Two separate things on every tile; do not merge them:
//   MEANING colour (src/lib/hexagonTile.ts, agreed MPC-7913): green = checked and clear, red = needs fixing, purple = our guess, grey = not checked / minor.
//   ARRIVAL colour (this file): HOW the information reached MPT. A blue family on purpose: green already means "safe" and must never mean "was sent to us".
// Colour is never the only clue: each arrival class also has a letter and a ring style (same rule as the tiles' glyphs).

import { CATALOGUE_CHANNELS } from './catalogue.js';

// MPC-8689: all 26 channels of the complete footprint come from catalogue.js (generated from the approved 366-hexagon discovery). Telegram and WhatsApp keep
// their short labels; every other channel keeps the label from the discovery. Only Telegram has channel hexagons built (TELEGRAM_HEXAGONS below).
export const CHANNELS = Object.fromEntries(CATALOGUE_CHANNELS.map((c) => [c.key, { code: c.code, label: c.label }]));
CHANNELS.telegram = { code: 'TG', label: 'Telegram' };
CHANNELS.whatsapp = { code: 'WA', label: 'WhatsApp' }; // reserved: no hexagons defined yet

export const ARRIVAL = {
  A: { id: 'A', label: 'Sent with every message', colour: '#1e3a8a', ring: 'solid-thick', note: 'Always arrives; nothing the person can switch off.' },
  B: { id: 'B', label: 'Public profile lookup', colour: '#2563eb', ring: 'solid', note: 'Only if the person\'s own privacy settings allow it.' },
  C: { id: 'C', label: 'Only if you share it', colour: '#38bdf8', ring: 'dashed', note: 'Arrives only when the person taps a share button.' },
  D: { id: 'D', label: 'Wider lookup (not in the baseline)', colour: '#bae6fd', ring: 'dotted', note: 'Extra lookups that need a separate decision.' },
};

// Observation states (strategy 11.4). Never "hidden" or "private": we only know what THIS bot received.
export const OBSERVATION_STATES = ['returned', 'not_returned', 'not_checked', 'check_failed', 'user_provided'];

const h = (key, label, arrival, source, observation, extra = {}) => ({
  id: `tg.${key}`, channel: 'TG', label, arrival, source, observation, enabled: true, ...extra,
});

// 30 hexagons for the worst possible Telegram account (A 9, B 18, C 2, D 1). Field names are from the Bot API as recalled on 2026-10-26;
// re-check them against the current official docs before any field is shown to a real user.
export const TELEGRAM_HEXAGONS = [
  // A: sent with every message
  h('numeric_id', 'Numeric Telegram id', 'A', 'message.from.id', 'direct'),
  h('first_name', 'First name', 'A', 'message.from.first_name', 'direct'),
  h('last_name', 'Last name', 'A', 'message.from.last_name', 'direct'),
  h('username', '@username', 'A', 'message.from.username', 'direct'),
  h('language', 'Language setting', 'A', 'message.from.language_code', 'direct'),
  h('message_time', 'Message time', 'A', 'message.date', 'direct'),
  h('message_text', 'What you typed', 'A', 'message.text', 'direct'),
  h('message_counter', 'Message counter', 'A', 'message.message_id', 'inferred', { enabled: false, disabledReason: 'message_id is not a verified volume counter (MPC-7891 measurement B)' }),
  h('update_counter', 'Bot update counter', 'A', 'update_id', 'direct', { note: 'Shared by everyone who writes to the bot; not a count of your messages.' }),
  // B: public profile lookup (getChat, getUserProfilePhotos)
  h('bio', 'Bio', 'B', 'getChat.bio', 'direct'),
  h('birthday', 'Birthday', 'B', 'getChat.birthdate', 'direct'),
  h('photo_current', 'Profile photo', 'B', 'getChat.photo / getUserProfilePhotos', 'direct'),
  h('photo_history', 'Older profile photos', 'B', 'getUserProfilePhotos', 'direct'),
  h('photo_fingerprint', 'Photo fingerprint', 'B', 'file_unique_id', 'direct', { note: 'Stable across bots, so the same photo can be recognised elsewhere.' }),
  h('extra_usernames', 'Extra @usernames', 'B', 'getChat.active_usernames', 'direct'),
  h('premium', 'Premium status', 'B', 'getChat.is_premium', 'direct'),
  h('emoji_status', 'Emoji status', 'B', 'getChat.emoji_status_custom_emoji_id', 'direct'),
  h('profile_colour', 'Profile colour', 'B', 'getChat.profile_accent_color_id / accent_color_id', 'direct', { note: 'The default name colour equals id mod 7 (seen on one test account).' }),
  h('profile_background', 'Profile background emoji', 'B', 'getChat.profile_background_custom_emoji_id', 'direct'),
  h('gift_settings', 'Gift settings', 'B', 'getChat.accepted_gift_types', 'direct'),
  h('business_intro', 'Business intro', 'B', 'getChat.business_intro', 'direct'),
  h('business_location', 'Business address', 'B', 'getChat.business_location', 'direct'),
  h('business_hours', 'Business opening hours', 'B', 'getChat.business_opening_hours', 'direct'),
  h('personal_channel', 'Personal channel', 'B', 'getChat.personal_chat', 'direct'),
  h('channel_posts', 'Public channel posts', 'B', 'getChat(personal_chat) / public posts', 'direct'),
  h('forward_privacy', 'Forwarding privacy', 'B', 'getChat.has_private_forwards', 'direct'),
  h('voice_restriction', 'Voice and video message restriction', 'B', 'getChat.has_restricted_voice_and_video_messages', 'direct'),
  // C: only if the person shares it
  h('phone_shared', 'Phone number you share', 'C', 'message.contact (share-contact button)', 'direct', { enabled: false, disabledReason: 'No share-contact button is built' }),
  h('location_shared', 'Location you share', 'C', 'message.location (share-location button)', 'direct', { enabled: false, disabledReason: 'No share-location button is built' }),
  // D: wider lookups
  h('group_role', 'Group membership and role', 'D', 'getChatMember (only when the bot shares a group)', 'direct', { enabled: false, disabledReason: 'Not part of the baseline scan' }),
];

// MPC-8689 pilot: Telegram "extra" hexagons. Built and checked by the baseline scan, but NOT part of the 30 above: they stay out of the Telegram risk
// number (risk-count-1, out of 30), the web 54 and the exposure score until the owner approves a new score version. Fields were checked against the
// current Bot API (10.3, 2026-08-24). Each is something that only appears when the person does it (forwards, sends while away, replies to a story, uses an
// inline bot) or sets it up (profile music), so "not returned" means "not in this message", never "protected". Not built from the discovery list:
// edits and reactions arrive as separate updates the baseline does not read; getUserProfileAudios and ChatJoinRequest.bio could not be confirmed in the docs.
export const TELEGRAM_EXTRA_HEXAGONS = [
  h('forward_origin', 'Where forwards come from', 'A', 'message.forward_origin', 'direct'),
  h('offline_send', 'Sent while away', 'A', 'message.is_from_offline', 'direct'),
  h('story_reply', 'Story replies', 'A', 'message.reply_to_story', 'direct'),
  h('via_bot', 'Other bots used', 'A', 'message.via_bot', 'direct'),
  h('profile_audio', 'Profile music', 'B', 'getChat.first_profile_audio', 'direct'),
];
export const TELEGRAM_EXTRA_IDS = TELEGRAM_EXTRA_HEXAGONS.map((x) => x.id);
// Email extras live in workers/scan-report/lib/emailExtras.js (EMAIL_EXTRA_HEXAGONS); their catalogue ids are listed here so the footprint count knows they are built.
export const EMAIL_EXTRA_IDS = ['email.alias', 'email.address_type', 'email.saas_records', 'email.mail_protection'];
export const EXTRA_HEXAGON_IDS = [...TELEGRAM_EXTRA_IDS, ...EMAIL_EXTRA_IDS];

export const CHANNEL_HEXAGONS = { TG: TELEGRAM_HEXAGONS };
export const TELEGRAM_HEXAGON_COUNT = TELEGRAM_HEXAGONS.length;

export function getChannelHexagon(id) {
  return TELEGRAM_HEXAGONS.find((x) => x.id === id) ?? null;
}

/** Channel code of a hexagon id ("tg.username" -> "TG"), or null when the id is not a channel hexagon. */
export function channelOfHexagon(id) {
  const prefix = typeof id === 'string' ? id.split('.')[0].toUpperCase() : '';
  return Object.values(CHANNELS).some((c) => c.code === prefix) ? prefix : null;
}
