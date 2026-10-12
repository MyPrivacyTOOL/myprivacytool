-- MPC-7251 follow-up (2026-10-12): wording rewritten to match what the free scan really does (DRAFT, needs Chris's approval; live rows are NOT updated by this file until it is applied).
-- MPT-1003: English seed for public.localization, generated from locales/en/main.json (source: workers/telegram-webhook).
-- Idempotent. Other locales are not seeded: their values are empty placeholders until translated.
-- Rollback: delete from public.localization where locale = 'en' and key like 'bot.%';
insert into public.localization (key, locale, value, description, status) values
  ('bot.first_hexagon.title', 'en', '🔍 *Here''s what the free MyPrivacyTOOL scan looks at:*', 'First Hexagon reply header', 'draft'),
  ('bot.first_hexagon.name', 'en', '• What your browser and device reveal to every website you visit', 'Exposure line: name', 'draft'),
  ('bot.first_hexagon.location', 'en', '• What your IP address reveals, such as your approximate city and country', 'Exposure line: location', 'draft'),
  ('bot.first_hexagon.phone', 'en', '• What your email address reveals, such as its provider and any public profile', 'Exposure line: phone', 'draft'),
  ('bot.first_hexagon.email', 'en', '• Breach history: not checked automatically yet, so your report gives you a link to check it yourself', 'Exposure line: email', 'draft'),
  ('bot.first_hexagon.social', 'en', '• People-search sites: your report has opt-out guides to follow step by step', 'Exposure line: social profiles', 'draft'),
  ('bot.first_hexagon.brokers', 'en', '• Data broker databases: not searched yet, and I''ll say so plainly in your report', 'Exposure line: data brokers', 'draft'),
  ('bot.first_hexagon.question', 'en', 'I can''t see your Telegram profile, phone number or contacts, only what you type here. Want to run the scan now?', 'Confirmation question', 'draft'),
  ('bot.first_hexagon.reply_y', 'en', 'Reply *Y* and I''ll send you the link.', 'Prompt: confirm Y', 'draft'),
  ('bot.first_hexagon.reply_n', 'en', 'Reply *N* if you''d rather not for now.', 'Prompt: reject N', 'draft'),
  ('bot.confirmed_y.title', 'en', '✅ *Great.*', 'Y confirmation header', 'draft'),
  ('bot.confirmed_y.generating', 'en', 'You run the scan in your browser.', 'Y confirmation body', 'draft'),
  ('bot.confirmed_y.cta', 'en', '👉 Start here:', 'Y confirmation CTA (URL appended by code)', 'draft'),
  ('bot.confirmed_y.duration', 'en', 'When it''s done, give your email and we''ll send you your report.', 'Y confirmation footer', 'draft'),
  ('bot.confirmed_n.title', 'en', '👍 *No problem.*', 'N confirmation header', 'draft'),
  ('bot.confirmed_n.cta', 'en', 'Whenever you want to run the free scan, it''s here:', 'N confirmation CTA (URL appended by code)', 'draft'),
  ('bot.confirmed_n.duration', 'en', 'Say *"scan me"* any time to see this again.', 'N confirmation footer', 'draft'),
  ('bot.unknown.title', 'en', '👋 *Welcome to MyPrivacyTOOL.*', 'Welcome / unknown-input header', 'draft'),
  ('bot.unknown.body', 'en', 'Say *"scan me"* and I''ll tell you what our free scan looks at and send you the link to run it.', 'Welcome body', 'draft'),
  ('bot.unknown.free', 'en', 'It''s free. You''ll be asked for your email so we can send your report.', 'Welcome footer', 'draft'),
  ('bot.confirm_prompt', 'en', 'Reply *Y* to get the link to the free scan, or *N* if you''d rather not.', 'Re-prompt on invalid reply', 'draft')
on conflict (key, locale) do update
  set value = excluded.value, description = excluded.description, updated_at = now();
