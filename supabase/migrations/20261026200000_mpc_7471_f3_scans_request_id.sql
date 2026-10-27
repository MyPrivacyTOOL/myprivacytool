-- MPC-7471-F3: a per-submit key on the report request, so a retry of the SAME post-scan popup submit (timeout after a successful write, double click) is recognised.
-- The popup keeps one random UUID for the whole form and sends it as request_id; the Worker returns the original outcome (including the scan number) only to a request
-- that carries the same key. It holds no personal data, and it is not a login or an access key for anything else.
-- NOT APPLIED. Needs Chris's migration approval. The Worker reads and writes this column only while REPORT_REQUEST_ID_ENABLED is "true" (wrangler.toml, default off),
-- so apply this first, then flip the switch. Safe to apply with the switch off.
--
-- Rollback (switch off first):
--   drop index if exists public.scans_request_id_key;
--   alter table public.scans drop column if exists request_id;

alter table public.scans add column if not exists request_id uuid;

-- One report request per key. Partial: existing rows and requests without a key are unaffected.
create unique index if not exists scans_request_id_key on public.scans (request_id) where request_id is not null;

comment on column public.scans.request_id is 'MPC-7471-F3. Random per-submit key from the post-scan popup. Lets a retry of the same submit get the original outcome. No personal data.';
