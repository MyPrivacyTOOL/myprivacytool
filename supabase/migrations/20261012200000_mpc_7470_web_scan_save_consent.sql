-- MPC-7470 (decision D12): a web scan is saved only when the visitor gives an email address and ticks the separate
-- "Save my scan result with my email ..." box at the contact step. The proof of that consent lives on the link between the
-- saved scan and the contact: when it was given and which version of the tick-box wording the visitor saw.
--
-- Additive and nullable (rows linked before D12 have no record), idempotent, safe to apply before the Worker change is deployed.
-- Apply this BEFORE turning WEB_SCAN_SAVE_ENABLED on: the Worker writes these two columns when it links a scan.
-- The 90-day rule for scans never linked to a contact (web_scan_retention.unlinked_days) is now unused, because no scan is saved
-- without a contact; it is left in place, harmless, and can be set to null.
-- Rollback: alter table public.web_scan_contacts drop column if exists save_consent_at, drop column if exists save_consent_version;

alter table public.web_scan_contacts
  add column if not exists save_consent_at      timestamptz,
  add column if not exists save_consent_version text check (save_consent_version is null or save_consent_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}-v[0-9]{1,3}$');

comment on column public.web_scan_contacts.save_consent_at is 'MPC-7470. When the visitor ticked "Save my scan result with my email ..." and submitted the contact form (Worker clock). Null on links made before D12.';
comment on column public.web_scan_contacts.save_consent_version is 'MPC-7470. Version of the tick-box wording the visitor saw, e.g. 2026-10-12-v1 (src/lib/saveConsent.ts, SAVE_CONSENT_VERSIONS in the Worker). Null on links made before D12.';
