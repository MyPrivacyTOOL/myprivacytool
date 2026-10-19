# MPC-7877 — GCP steps (approved; run by a human with GCP access)

The agent session could not reach GCP (proxy 403), so these were NOT run. Replace PROJECT. Staging first.

## 1. Signing key (Ed25519) — generate locally, load straight into Secret Manager, never keep the file
```
openssl genpkey -algorithm ED25519 -outform DER | tail -c 32 | xxd -p -c 64 > /dev/shm/seed   # hex seed (app reads SIGNING_KEY_HEX)
gcloud secrets create shadow-audit-ed25519-key-staging --project PROJECT --replication-policy=automatic
gcloud secrets versions add shadow-audit-ed25519-key-staging --project PROJECT --data-file=/dev/shm/seed
shred -u /dev/shm/seed
gcloud secrets add-iam-policy-binding shadow-audit-ed25519-key-staging --project PROJECT \
  --member=serviceAccount:shadow-audit-staging@PROJECT.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
```
Publish the public key; do not grant accessor to any human.

## 2. Cloud Run (staging only)
Code is built (Phases 2-5). Also create secrets shadow-audit-api-token-staging, shadow-audit-notion-token, shadow-audit-slack-webhook, grant the runtime SA accessor, then:
`gcloud builds submit --config cloudbuild.yaml --project PROJECT` (needs Artifact Registry repo `shadow-audit`). The LOG_TABLE env var (BigQuery table) must also be set; the BigQuery adapter is untested.

## 3. Cloud Scheduler (weekly, Sun 02:00 UTC) — after step 2 (one job per agent; a run-all endpoint is not built), pointing at the staging URL
```
gcloud scheduler jobs create http shadow-audit-weekly --project PROJECT --schedule="0 2 * * 0" --time-zone=UTC \
  --uri=https://STAGING_URL/audit/AGENT_ID --http-method=POST --oidc-service-account-email=shadow-audit-staging@PROJECT.iam.gserviceaccount.com
```
