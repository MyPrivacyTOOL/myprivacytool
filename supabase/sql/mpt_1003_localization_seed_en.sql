-- MPT-1003: English seed for public.localization, generated from locales/en/main.json (source: workers/telegram-webhook).
-- Idempotent. Other locales are not seeded: their values are empty placeholders until translated.
-- Rollback: delete from public.localization where locale = 'en' and key like 'bot.%';
insert into public.localization (key, locale, value, description, status) values
  ('bot.first_hexagon.title', 'en', '🔍 *Here''s what''s publicly known about you right now:*', 'First Hexagon reply header', 'draft'),
  ('bot.first_hexagon.name', 'en', '✅ Name: visible from your Telegram profile', 'Exposure line: name', 'draft'),
  ('bot.first_hexagon.location', 'en', '✅ Location: city & country estimable from IP', 'Exposure line: location', 'draft'),
  ('bot.first_hexagon.phone', 'en', '⚠️ Phone: possibly linked to this account', 'Exposure line: phone', 'draft'),
  ('bot.first_hexagon.email', 'en', '⚠️ Email: may be findable via data brokers', 'Exposure line: email', 'draft'),
  ('bot.first_hexagon.social', 'en', '⚠️ Social profiles: cross-platform links detected', 'Exposure line: social profiles', 'draft'),
  ('bot.first_hexagon.brokers', 'en', '🚨 Data broker exposure: estimated 40+ sites', 'Exposure line: data brokers', 'draft'),
  ('bot.first_hexagon.question', 'en', 'Is this data about you?', 'Confirmation question', 'draft'),
  ('bot.first_hexagon.reply_y', 'en', 'Reply *Y* to see your full privacy report and start removing yourself from data broker sites.', 'Prompt: confirm Y', 'draft'),
  ('bot.first_hexagon.reply_n', 'en', 'Reply *N* if this profile doesn''t match you — we''ll run a fresh scan.', 'Prompt: reject N', 'draft'),
  ('bot.confirmed_y.title', 'en', '✅ *Confirmed.*', 'Y confirmation header', 'draft'),
  ('bot.confirmed_y.generating', 'en', 'Your full privacy report is being generated now.', 'Y confirmation body', 'draft'),
  ('bot.confirmed_y.cta', 'en', '👉 Go here to see it and start the removal process:', 'Y confirmation CTA (URL appended by code)', 'draft'),
  ('bot.confirmed_y.duration', 'en', 'We''ll walk you through every step. It takes about 5 minutes.', 'Y confirmation footer', 'draft'),
  ('bot.confirmed_n.title', 'en', '🔍 *No problem — let''s find the right profile.*', 'N confirmation header', 'draft'),
  ('bot.confirmed_n.cta', 'en', 'Run a fresh scan with your details here:', 'N confirmation CTA (URL appended by code)', 'draft'),
  ('bot.confirmed_n.duration', 'en', 'Takes 30 seconds.', 'N confirmation footer', 'draft'),
  ('bot.unknown.title', 'en', '👋 *Welcome to MyPrivacyTOOL.*', 'Welcome / unknown-input header', 'draft'),
  ('bot.unknown.body', 'en', 'Send me your name or just say *"scan me"* and I''ll show you what data brokers know about you right now.', 'Welcome body', 'draft'),
  ('bot.unknown.free', 'en', 'It''s free. No signup needed.', 'Welcome footer', 'draft'),
  ('bot.confirm_prompt', 'en', 'Reply *Y* to confirm this is you, or *N* if not.', 'Re-prompt on invalid reply', 'draft')
on conflict (key, locale) do update
  set value = excluded.value, description = excluded.description, updated_at = now();
