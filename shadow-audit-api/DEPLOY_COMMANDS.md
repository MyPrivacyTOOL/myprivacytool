# MPC-7877 — GCP deploy (staging) — run in Cloud Shell

Open: https://shell.cloud.google.com/ (pick the project in the top bar first).
Console links: Secret Manager https://console.cloud.google.com/security/secret-manager · Cloud Run https://console.cloud.google.com/run · Scheduler https://console.cloud.google.com/cloudscheduler · Build history https://console.cloud.google.com/cloud-build/builds

Code is in draft PR https://github.com/MyPrivacyTOOL/myprivacytool/pull/449 (branch claude/intelligent-thompson-wc3773).

```bash
# 0. Setup
export PROJECT=<your-gcp-project-id>        # gcloud projects list
export REGION=us-central1
gcloud config set project $PROJECT
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com \
  artifactregistry.googleapis.com cloudscheduler.googleapis.com bigquery.googleapis.com
git clone -b claude/intelligent-thompson-wc3773 https://github.com/MyPrivacyTOOL/myprivacytool.git
cd myprivacytool/shadow-audit-api

# 1. Runtime service account + registry
gcloud iam service-accounts create shadow-audit-staging
export SA=shadow-audit-staging@$PROJECT.iam.gserviceaccount.com
gcloud artifacts repositories create shadow-audit --repository-format=docker --location=$REGION
# read logs (BigQuery) for the audit:
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/bigquery.dataViewer
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$SA --role=roles/bigquery.jobUser

# 2. Signing key: generated here, straight into Secret Manager, never kept on disk
openssl genpkey -algorithm ED25519 -outform DER | tail -c 32 | xxd -p -c 64 > /dev/shm/seed
gcloud secrets create shadow-audit-ed25519-key-staging --replication-policy=automatic --data-file=/dev/shm/seed
shred -u /dev/shm/seed

# 3. API token (random) + the two secrets only you have (type them, don't paste into chat)
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create shadow-audit-api-token-staging --data-file=-
read -rs -p "Notion integration token: " T; echo; printf %s "$T" | gcloud secrets create shadow-audit-notion-token --data-file=-
read -rs -p "Slack webhook URL: " T; echo; printf %s "$T" | gcloud secrets create shadow-audit-slack-webhook --data-file=-; unset T
for S in shadow-audit-ed25519-key-staging shadow-audit-api-token-staging shadow-audit-notion-token shadow-audit-slack-webhook; do
  gcloud secrets add-iam-policy-binding $S --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor
done
# In Notion: share the "Agent Passports" database with your integration (••• > Connections).

# 4. Build + deploy to staging (runs the tests first)
gcloud builds submit . --config cloudbuild.yaml --substitutions=_REGION=$REGION
# LOG_TABLE defaults to <project>.agent_logs.logs (set in cloudbuild.yaml); the deploy uses --update-env-vars so it never wipes env vars.
# (--no-allow-unauthenticated is set: callers need a Google identity token AND the X-Api-Token header)

# 5. Smoke test (replace AGENT_ID with a non-prod agent)
URL=$(gcloud run services describe shadow-audit-api-staging --region=$REGION --format='value(status.url)')
TOK=$(gcloud secrets versions access latest --secret=shadow-audit-api-token-staging)
curl -s -H "Authorization: Bearer $(gcloud auth print-identity-token)" $URL/health
curl -s -X POST -H "Authorization: Bearer $(gcloud auth print-identity-token)" -H "X-Api-Token: $TOK" $URL/audit/AGENT_ID

# 6. Weekly cron (Sun 02:00 UTC), one job per agent
gcloud run services add-iam-policy-binding shadow-audit-api-staging --region=$REGION \
  --member=serviceAccount:$SA --role=roles/run.invoker
gcloud scheduler jobs create http shadow-audit-weekly-AGENT_ID --location=$REGION --schedule="0 2 * * 0" --time-zone=UTC \
  --uri=$URL/audit/AGENT_ID --http-method=POST --headers="X-Api-Token=$TOK" \
  --oidc-service-account-email=$SA --oidc-token-audience=$URL
```

Notes
- The BigQuery table must have columns: ts, text, tool, session, vault_start, vault_end, agent_id. The adapter is untested; if step 5 returns status "incomplete", read the `errors` field.
- Passports from this service say `environment: staging` and are signed with the staging key. Do not reuse this key for production.
- The X-Api-Token value is stored in the Scheduler job config; treat that job as sensitive.
