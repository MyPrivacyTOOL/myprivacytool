-- MPC-9892 canary test, step 1 (design 4.5 proof 2): seed one scan with a unique email, IP, scan number and user agent, committed (not rolled back),
-- so that step 2 can run the deletion job and grep a dump of the WHOLE database and the job log for each canary. Throwaway database only.
-- Canary values are made up and appear nowhere else in the repository's SQL.
insert into public.web_scans (id, created_at, source, hexagon_count, results, results_bytes) values
  ('9892c0de-ca9a-4c4e-8a11-000000009892', now() - interval '100 days', 'web', 2,
   '[{"id":"location","status":"found","value":"198.51.100.219"},{"id":"email-domain","status":"found","value":"canary-9892-zqx7@example.invalid"}]', 200);
insert into public.web_scan_events (web_scan_id, step) values
  ('9892c0de-ca9a-4c4e-8a11-000000009892', 'scan_started'), ('9892c0de-ca9a-4c4e-8a11-000000009892', 'scan_finished');
insert into public.edge_visits (path, method, user_agent, ip, country, class, rule, ruleset_version) values
  ('/', 'GET', 'CanaryAgent-9892-QZ/3.1 (canary-ua-token) ClaudeBot/1.0', '198.51.100.219', 'DE', 'ai', 'ua', 'v1');
