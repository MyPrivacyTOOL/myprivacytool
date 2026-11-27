-- MPC-9816 (F2 Paid Exposure Report): PDF and JSON export now exist in the Worker (POST /api/account/export, GET /api/export), so their capability rows read 'live'.
-- Data only (spec s3: thresholds are data). Idempotent. Rollback: update public.capability_min_tier set status = 'planned' where key in ('report.export_pdf', 'report.export_json');
update public.capability_min_tier set status = 'live' where key in ('report.export_pdf', 'report.export_json') and status <> 'live';
