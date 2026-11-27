-- MPC-8737: synthetic legacy rows for the backfill test. Synthetic only; nothing here resembles a real person.
\set ON_ERROR_STOP on
insert into public.users (id, email, email_verified) values
  ('87370000-0000-4000-8000-000000000001', 'alice@example.com', true),
  ('87370000-0000-4000-8000-000000000002', 'bob@example.com', false);
insert into public.leads (id, email, phone_number) values
  ('87370000-0000-4000-8000-0000000000a1', 'alice@example.com', '+85212345678'),
  ('87370000-0000-4000-8000-0000000000a2', 'carol@example.com', null);
insert into public.scans (id, user_id, email_scanned) values
  ('87370000-0000-4000-8000-0000000000b1', '87370000-0000-4000-8000-000000000001', 'alice@example.com'),
  ('87370000-0000-4000-8000-0000000000b2', '87370000-0000-4000-8000-000000000002', 'bob@example.com');
insert into public.signals (id, scan_id, category, signal_type, severity, data_source, check_status, details) values
  ('87370000-0000-4000-8000-0000000000c1', '87370000-0000-4000-8000-0000000000b1', 'email', 'Breach Lookup', 'low',    'HIBP', 'not_checked', 'HIBP API key not configured'),
  ('87370000-0000-4000-8000-0000000000c2', '87370000-0000-4000-8000-0000000000b1', 'email', 'Gravatar',      'low',    'Gravatar', 'clear', 'No public Gravatar'),
  ('87370000-0000-4000-8000-0000000000c3', '87370000-0000-4000-8000-0000000000b1', 'broker', 'Spokeo',       'high',   'Broker list', 'found', 'Listed on a broker site'),
  ('87370000-0000-4000-8000-0000000000c4', '87370000-0000-4000-8000-0000000000b2', 'email', 'Breach Lookup', 'low',    'HIBP', 'not_checked', 'HIBP API key not configured'),
  ('87370000-0000-4000-8000-0000000000c5', '87370000-0000-4000-8000-0000000000b2', 'device', 'Local MX',    'medium', 'Analysed inside our Worker', 'not_checked', null);
insert into public.web_scans (id, hexagon_count, results, results_bytes) values
  ('87370000-0000-4000-8000-0000000000d1', 8, $j$[
    {"id":"timezone","label":"Timezone","value":"Your timezone is Asia/Hong_Kong","confidence":100,"risk":"Attackers narrow your location","confirmed":false,"category":"device","status":"found","estimate":false},
    {"id":"webgl","label":"GPU","value":"Not checked","confidence":100,"confirmed":false,"category":"fingerprint","status":"not_checked"},
    {"id":"canvas","label":"Canvas","value":"x","confidence":1,"confirmed":false,"category":"fingerprint","status":"found"},
    {"id":"language","label":"Language","value":"en-HK","confidence":70,"confirmed":false,"category":"language","status":"found","estimate":true},
    {"id":"battery","label":"Battery","value":"no","confidence":90,"confirmed":false,"category":"device","status":"clear"},
    {"id":"audio","label":"Audio","value":"?","confidence":0,"confirmed":false,"category":"fingerprint","status":"not_checked"},
    {"label":"no id","status":"found","confidence":50},
    {"id":"nostatus","label":"No status","confidence":50}
  ]$j$::jsonb, 100),
  ('87370000-0000-4000-8000-0000000000d2', 1, '[{"id":"timezone","label":"Timezone","value":"Your timezone is UTC","confidence":95,"confirmed":false,"category":"device","status":"found"}]'::jsonb, 100);
insert into public.web_scan_contacts (id, web_scan_id, channel, contact_id, save_consent_at, save_consent_version, recognise_consent_at, recognise_consent_version) values
  ('87370000-0000-4000-8000-0000000000e1', '87370000-0000-4000-8000-0000000000d1', 'email', '87370000-0000-4000-8000-0000000000b1', now(), '2026-10-12-v1', null, null);
insert into public.conversation_states (id, lead_id, channel, state, sender_id) values
  ('87370000-0000-4000-8000-0000000000f1', null, 'telegram', 'awaiting_confirmation', '777000111'),
  ('87370000-0000-4000-8000-0000000000f2', null, 'telegram', 'awaiting_confirmation', 'someone_username'),
  ('87370000-0000-4000-8000-0000000000f3', '87370000-0000-4000-8000-0000000000a2', 'telegram', 'confirmed', '888000222');
insert into public.mpt_score_baselines (email_hash, overall_score, category_scores) values (encode(sha256(convert_to('alice@example.com', 'UTF8')), 'hex'), 61, '{"email":50}');
insert into public.mpt_user_engagement (session_id, bridge_clicked, email_confirmed, mobile_confirmed, full_scan_completed, channel) values ('sess-87370001', true, false, false, false, 'web');
insert into public.social_contacts (platform, platform_user_id, handle) values ('x', 'x-87370001', 'someone');
insert into public.channel_probe_captures (platform, sender_id, kind, payload, expires_at) values ('telegram', '555000333', 'message', '{}', now() + interval '1 day');
