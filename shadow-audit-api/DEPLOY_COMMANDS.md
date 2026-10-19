# MPC-7877 — GCP steps (approved; run by a human with GCP access)

The agent session could not reach GCP (proxy 403), so these were NOT run. Replace PROJECT. Staging first.

## 1. Signing key (Ed25519) — generate locally, load straight into Secret Manager, never keep the file
```
openssl genpkey -algorithm ED25519 -outform DER | tail -c 32 > /dev/shm/seed
gcloud secrets create shadow-audit-ed25519-key-staging --project PROJECT --replication-policy=automatic
gcloud secrets versions add shadow-audit-ed25519-key-staging --project PROJECT --data-file=/dev/shm/seed
shred -u /dev/shm/seed
gcloud secrets add-iam-policy-binding shadow-audit-ed25519-key-staging --project PROJECT \
  --member=serviceAccount:shadow-audit-staging@PROJECT.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
```
Publish the public key; do not grant accessor to any human.

## 2. Cloud Run (staging only) — NOT YET POSSIBLE
Phase 2-5 (routes, Notion/Slack integrations, Dockerfile) are not built; deploy after those land.

## 3. Cloud Scheduler (weekly, Sun 02:00 UTC) — after step 2, pointing at the staging URL
```
gcloud scheduler jobs create http shadow-audit-weekly --project PROJECT --schedule="0 2 * * 0" --time-zone=UTC \
  --uri=https://STAGING_URL/audit/run-all --http-method=POST --oidc-service-account-email=shadow-audit-staging@PROJECT.iam.gserviceaccount.com
```
