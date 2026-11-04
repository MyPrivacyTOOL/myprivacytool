# Ingest endpoint (MPC-8364)

Lets the droplet loader send masked audit-trail rows straight into the log table the audit reads, so nobody has to copy files around. A **second Cloud Run service from the same image** with `SERVICE_MODE=ingest`: it serves only `GET /health` and `POST /ingest/{agent}`; the audit service has no ingest route.

## Security model
- **Why public:** the droplet has no Google login, so it cannot call a private Cloud Run service. The ingest service is therefore deployed with `--allow-unauthenticated` and **the ingest token is the gate** (checked before the body is read; constant-time compare). If your organisation blocks unauthenticated services, this design needs a different transport.
- **Its own identity, least privilege:** service account `shadow-audit-ingest` can append to the `agent_logs` dataset only. The audit service account stays read-only.
- **Token:** a separate secret (`shadow-audit-ingest-token`), not the audit API token. If it leaks, the worst case is junk rows for an allowlisted agent (data poisoning, not data theft): rotate the secret and redeploy.
- **Allowlist:** only agents in `INGEST_AGENTS` (start with `testingnt69`); empty list = nothing accepted. The `agent_id` in every row must equal the one in the URL.
- **Validation and masking:** strict field list and size limits (max 1000 rows and 1.5 MB per request); text is masked **again** server-side, so a buggy or compromised client still cannot store the shapes the masker knows. Error replies never echo row content.
- **Duplicate-safe:** rows are keyed by (timestamp to the millisecond, tool, session, text hash); re-sending a window inserts nothing twice. Two requests racing at the same moment can still both insert (acceptable at this volume).
- **Not covered:** the audit trail's hash chain is not verified on the way in; rows are trusted because the loader runs on the droplet with the token.

## Deploy (staging, Cloud Shell, owner)
Prerequisite: this code is merged and the audit service image was rebuilt from `main` (the normal Cloud Build), so the image contains the ingest code.

```bash
export PROJECT=mpt-digital-shadow---deepseek REGION=us-central1
gcloud config set project $PROJECT
gcloud iam service-accounts create shadow-audit-ingest --display-name="Shadow Audit ingest (staging)"
ING=shadow-audit-ingest@$PROJECT.iam.gserviceaccount.com
gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$ING --role=roles/bigquery.jobUser --condition=None >/dev/null
bq --project_id=$PROJECT query --use_legacy_sql=false --location=US "GRANT \`roles/bigquery.dataEditor\` ON SCHEMA \`$PROJECT.agent_logs\` TO 'serviceAccount:$ING'"
openssl rand -hex 32 | tr -d '\n' | gcloud secrets create shadow-audit-ingest-token --replication-policy=automatic --data-file=-
gcloud secrets add-iam-policy-binding shadow-audit-ingest-token --member=serviceAccount:$ING --role=roles/secretmanager.secretAccessor --condition=None >/dev/null
IMG=$(gcloud run services describe shadow-audit-api-staging --region=$REGION --format='value(spec.template.spec.containers[0].image)')
gcloud run deploy shadow-audit-ingest-staging --image=$IMG --region=$REGION --service-account=$ING \
  --allow-unauthenticated --max-instances=2 --concurrency=10 --timeout=120 \
  --set-env-vars=SERVICE_MODE=ingest,SHADOW_AUDIT_ENV=staging,INGEST_AGENTS=testingnt69,LOG_TABLE=$PROJECT.agent_logs.logs \
  --set-secrets=INGEST_TOKEN=shadow-audit-ingest-token:latest
URL=$(gcloud run services describe shadow-audit-ingest-staging --region=$REGION --format='value(status.url)'); echo $URL
curl -s $URL/health        # must say "mode": "ingest" (if not, the image is older than this code)
```

## Use from the droplet
1. Put the token on the droplet once (typed at a hidden prompt; clear the screen afterwards). In Cloud Shell run `gcloud secrets versions access latest --secret=shadow-audit-ingest-token`, copy it, then on the droplet:
   ```bash
   read -rs T; printf %s "$T" > /root/loader-run/ingest.token; chmod 600 /root/loader-run/ingest.token; unset T; clear
   ```
2. Push (first run sends the last ~35 days; later runs send only what is new, using the state file):
   ```bash
   cd /root/loader-run && python3 -m loader.audit_log_loader --agent testingnt69 --audit-dir /root/openclaw/logs/audit \
     --since 2026-09-15T00:00:00Z --push "$URL" --token-file /root/loader-run/ingest.token --state-file /root/loader-run/state.json
   ```
3. Weekly (before the Sunday 02:00 UTC audit job), a root cron line: `0 1 * * 0 cd /root/loader-run && python3 -m loader.audit_log_loader --agent testingnt69 --audit-dir /root/openclaw/logs/audit --push "$URL" --token-file /root/loader-run/ingest.token --state-file /root/loader-run/state.json >> /root/loader-run/push.log 2>&1` (use the literal URL, cron has no `$URL`). The log holds counts and errors only.

## Rollback
`gcloud run services delete shadow-audit-ingest-staging --region=$REGION`, delete the secret `shadow-audit-ingest-token`, delete the service account `shadow-audit-ingest`, remove the droplet token file and cron line. Rows already loaded stay in the table.
