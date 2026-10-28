// MPC-7891: channel hexagons. One list per messaging channel, kept OUTSIDE the 54 web scan hexagons in registry.js (like EMAIL_HEXAGONS),
// so the web counts, score and tests do not change. Every channel hexagon carries a channel CODE in its id and a `channel` field, so a photo,
// a number or a name that comes back can always be traced to the tool it came from (Telegram "TG", WhatsApp "WA" when built).
//
// Two separate things on every tile; do not merge them:
//   MEANING colour (src/lib/hexagonTile.ts, agreed MPC-7913): green = checked and clear, red = needs fixing, purple = our guess, grey = not checked / minor.
//   ARRIVAL colour (this file): HOW the information reached MPT. A blue family on purpose: green already means "safe" and must never mean "was sent to us".
// Colour is never the only clue: each arrival class also has a letter and a ring style (same rule as the tiles' glyphs).

export const CHANNELS = {
  telegram: { code: 'TG', label: 'Telegram' },
  whatsapp: { code: 'WA', label: 'WhatsApp' }, // reserved: no hexagons defined yet
  x: { code: 'X', label: 'X' }, // CK-8502
};

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

// CK-8502: X hexagons. Fields are the ones X's Account Activity documentation shows in its payload examples (docs.x.com, read 2026-10-28; the
// user-object field list there is an EXAMPLE, not a specification, so a field may be absent). NOTE: that page says the Account Activity API is
// being deprecated in favour of the X Activity API; re-map the sources when we move. Same arrival classes as Telegram. Stored only when the
// Worker flag X_CAPTURE_HEXAGONS is "on" (owner decision D1, 2026-10-28: record every data point; legal sign-off and wording change still required).
const hx = (key, label, arrival, source, observation, extra = {}) => ({
  id: `x.${key}`, channel: 'X', label, arrival, source, observation, enabled: true, ...extra,
});
export const X_HEXAGONS = [
  // A: arrives with the event
  hx('numeric_id', 'Numeric X id', 'A', 'user.id / source.id / sender_id', 'direct'),
  hx('name', 'Display name', 'A', 'user.name', 'direct'),
  hx('screen_name', '@handle', 'A', 'user.screen_name', 'direct'),
  hx('location', 'Profile location', 'A', 'user.location', 'direct'),
  hx('description', 'Bio', 'A', 'user.description', 'direct'),
  hx('url', 'Profile link', 'A', 'user.url', 'direct'),
  hx('protected', 'Protected account', 'A', 'user.protected', 'direct'),
  hx('verified', 'Verified', 'A', 'user.verified', 'direct'),
  hx('followers_count', 'Followers', 'A', 'user.followers_count', 'direct'),
  hx('friends_count', 'Following', 'A', 'user.friends_count', 'direct'),
  hx('statuses_count', 'Posts', 'A', 'user.statuses_count', 'direct'),
  hx('profile_image', 'Profile photo address', 'A', 'user.profile_image_url_https', 'direct'),
  hx('event_time', 'Event time', 'A', 'created_timestamp / timestamp_ms', 'direct'),
  hx('post_text', 'Text of the post that mentions or shares us', 'A', 'tweet_create_events[].text', 'direct'),
  hx('post_language', 'Post language', 'A', 'tweet_create_events[].lang', 'direct', { note: 'Tweet field, not shown in the docs example; absent is normal.' }),
  hx('message_text', 'What you typed (DM)', 'A', 'message_create.message_data.text', 'direct'),
  // B: public profile lookup (needs the bearer token and spends API credits; used today only by the Mirror, not by capture)
  hx('lookup_profile', 'Public profile lookup', 'B', 'GET /2/users/:id', 'direct', { enabled: false, disabledReason: 'Spends API credits; not part of capture' }),
  // D: wider lookups
  hx('timeline', 'Recent public posts', 'D', 'GET /2/users/:id/tweets', 'direct', { enabled: false, disabledReason: 'Needs a separate decision' }),
];
export const X_HEXAGON_COUNT = X_HEXAGONS.length;

export const CHANNEL_HEXAGONS = { TG: TELEGRAM_HEXAGONS, X: X_HEXAGONS };
export const TELEGRAM_HEXAGON_COUNT = TELEGRAM_HEXAGONS.length;

export function getChannelHexagon(id) {
  return [...TELEGRAM_HEXAGONS, ...X_HEXAGONS].find((x) => x.id === id) ?? null;
}

/** Channel code of a hexagon id ("tg.username" -> "TG"), or null when the id is not a channel hexagon. */
export function channelOfHexagon(id) {
  const prefix = typeof id === 'string' ? id.split('.')[0].toUpperCase() : '';
  return Object.values(CHANNELS).some((c) => c.code === prefix) ? prefix : null;
}
