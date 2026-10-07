-- MPC-8302: English seed for the Mirror & Risk keys (risk.*) in public.localization (table from MPT-1003).
-- Idempotent. Other locales stay empty placeholders in /locales until translated; status=draft pending copy approval.
-- Rollback: delete from public.localization where locale = 'en' and key like 'risk.%';
insert into public.localization (key, locale, value, description, status) values
  ('risk.summary.low.title', 'en', '🟢 *Good news: nothing found.*', 'Risk summary header: low', 'draft'),
  ('risk.summary.medium.title', 'en', '🟡 *Some exposure found.*', 'Risk summary header: medium', 'draft'),
  ('risk.summary.high.title', 'en', '🟠 *Significant exposure found.*', 'Risk summary header: high', 'draft'),
  ('risk.summary.critical.title', 'en', '🔴 *Urgent: heavy exposure found.*', 'Risk summary header: critical', 'draft'),
  ('risk.summary.unknown.title', 'en', '⚪ *I could not check this one.*', 'Risk summary header: not checked', 'draft'),
  ('risk.summary.low.body', 'en', 'This address does not appear in any public breach or paste I can see. Staying that way takes a few habits.', 'Risk summary body: low', 'draft'),
  ('risk.summary.medium.body', 'en', 'It shows up in public data, but a few quick steps will cut the risk.', 'Risk summary body: medium', 'draft'),
  ('risk.summary.high.body', 'en', 'Your details are in several public leaks. Act on the steps below soon.', 'Risk summary body: high', 'draft'),
  ('risk.summary.critical.body', 'en', 'Your details are widely leaked. Please do the steps below today.', 'Risk summary body: critical', 'draft'),
  ('risk.summary.unknown.body', 'en', 'Nothing was guessed, so there is no score to show.', 'Risk summary body: not checked', 'draft'),
  ('risk.mirror.header', 'en', 'Here is what public sources show for *{input}*:', 'Mirror header; {input} = value the user gave us', 'draft'),
  ('risk.mirror.breaches_one', 'en', '• {count} known data breach', 'Mirror line: exactly one breach', 'draft'),
  ('risk.mirror.breaches_other', 'en', '• {count} known data breaches', 'Mirror line: 0 or many breaches', 'draft'),
  ('risk.mirror.pastes_one', 'en', '• {count} public paste', 'Mirror line: exactly one paste', 'draft'),
  ('risk.mirror.pastes_other', 'en', '• {count} public pastes', 'Mirror line: many pastes (omitted when 0 or unknown)', 'draft'),
  ('risk.mirror.breach_names', 'en', '• Seen in: {names}', 'Mirror line: breach names (first few)', 'draft'),
  ('risk.mirror.data_classes', 'en', '• Exposed data types: {classes}', 'Mirror line: data classes leaked', 'draft'),
  ('risk.mirror.score', 'en', 'Exposure score: *{score}/100*', 'Mirror line: score', 'draft'),
  ('risk.mirror.not_checked', 'en', 'Reason: {reason}', 'Mirror line: why the lookup did not run', 'draft'),
  ('risk.mirror.partial', 'en', 'Note: paste data was unavailable, so the score may be low.', 'Mirror line: confidence medium', 'draft'),
  ('risk.next.title', 'en', '*What to do next:*', 'Next steps header', 'draft'),
  ('risk.next.change_passwords', 'en', 'Change the password on every account that uses this email.', 'Next step', 'draft'),
  ('risk.next.rotate_reused', 'en', 'If you reused a leaked password anywhere else, change it there too.', 'Next step', 'draft'),
  ('risk.next.enable_2fa', 'en', 'Turn on two-factor authentication for your email and banking.', 'Next step', 'draft'),
  ('risk.next.review_brokers', 'en', 'Check which data brokers list you and request removal.', 'Next step', 'draft'),
  ('risk.next.scan_cta', 'en', 'Reply *Y* for your full privacy report and removal walkthrough.', 'Next step: CTA', 'draft'),
  ('risk.next.monitor', 'en', 'Re-check in a few months or after any breach news.', 'Next step', 'draft'),
  ('risk.next.nothing_urgent', 'en', 'Nothing urgent to do right now.', 'Next step', 'draft'),
  ('risk.next.try_email', 'en', 'Send me an email address and I can check it against public breaches.', 'Next step: unsupported input type', 'draft')
on conflict (key, locale) do update
  set value = excluded.value, description = excluded.description, updated_at = now();
