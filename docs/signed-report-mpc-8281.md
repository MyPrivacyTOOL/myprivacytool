# Signed report download (MPC-8281)

`POST /api/report-download` signs a report with ed25519; `POST /api/verify-report` checks one. Code: `shared/signed-report/`, thin wrappers in `functions/api/`.

## What is built
- **JSON**: `{ "report": ..., "signature": { alg, issuer, signed_at, key_id, public_key, value, timestamp } }`. The signature covers the canonical form of `{ issuer, signed_at, report }`. The public key is embedded.
- **PDF**: detached signature over the PDF bytes (`{ pdf_base64 }` in, `{ signature }` out; verify takes the PDF and the signature).
- **Download button** (`FinalSummaryPanel`): "Download signed report" downloads `*.signed.json`, and in the full (non-tile) view also the PDF and `*.pdf.sig.json`, the detached signature over those exact bytes. Hidden unless `VITE_SIGNED_REPORT=true` AND the `level2Complete` prop is true. Nothing passes `level2Complete` yet, so it stays hidden in production. A refusal (403/503) shows a plain message and downloads nothing.
- **Verified means two things**: the signature is intact (`signature_valid`) AND the key is one we published (`issuer_key_trusted`, from `REPORT_SIGNING_PUBLIC_KEYS`). A valid signature from a stranger's key is reported but not "verified".
- **RFC 3161**: `rfc3161Timestamper(url)` builds the request and reads the PKIStatus. `timestamp_binds_digest` checks the token contains our digest. The authority's own CMS signature on the token is NOT validated yet. If the authority is down the file is signed with `timestamp: null`.
- **Fails closed**: 503 unless `REPORT_SIGNING_ENABLED=1` and a key is set; 403 unless the Level 2 gate passes. The gate (`Deps.level2Passed`) always answers false until MPC-7902 provides a real check, so nothing is signed in production at merge.

## Not done (needs a person or another task)
1. **Signing key**: the spec says GCP Secret Manager. These Pages Functions run on Cloudflare, so the seed goes in as the Pages secret `REPORT_SIGNING_KEY` unless Chris wants a Secret Manager fetch added. Creating the key is irreversible; Chris approves it. Generate offline: `openssl rand -base64 32` (never commit it), then publish the public key (`public_key` from a test signature) in `REPORT_SIGNING_PUBLIC_KEYS`.
2. **Level 2 gate** (MPC-7902, not started): replace the default in `functions/api/report-download.ts`.
3. ~~Download button + PDF~~ built (see above). Remaining: pass `level2Complete` from the Level 2 flow once MPC-7902 exists, set `VITE_SIGNED_REPORT=true` for the build, and tell users how to check a file (an upload page for `/api/verify-report`).
4. **TSA choice** (`REPORT_TSA_URL`) and, if wanted, full validation of the token's CMS signature.
5. Production end-to-end test: download, upload, verified.

## Known limits (2026-10-26 review)
- **What a signature proves.** The report is built in the browser and the server signs what it receives, so a signature proves "this exact file was signed by MyPrivacyTOOL", not "MyPrivacyTOOL found these results". The /verify-report page says so. The real fix is for the server to sign scan data it holds itself (look up the saved scan by id), which needs a server-side data source (Supabase credentials as a Pages secret) and the MPC-7898 ledger. Do this before relying on signatures as evidence.
- **Timestamps.** The page no longer mentions the outside time stamp: the authority's own signature on the token is not validated yet, and the digest check is a plain byte search.
- **Real-browser coverage.** `e2e/verify-report.spec.ts` covers the upload page in Chromium (desktop and mobile). The multi-file download button is covered only in jsdom because it needs `VITE_SIGNED_REPORT` set at build time; add an e2e when the feature is switched on.
