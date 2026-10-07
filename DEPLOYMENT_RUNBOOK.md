# Core Brain Staging Deployment Runbook — MPC-7257

## Overview
This runbook covers the end-to-end deployment of **Core Brain** (privacy analysis orchestrator) to Cloudflare staging, including webhook integration (X/Telegram), intent classification (Mirror & Risk Engine), response templating, and logging.

**Status:** Ready to deploy
**Target:** Cloudflare Workers staging (`*.staging.workers.dev`)
**Components:** core-brain Worker + Supabase Edge Functions + Qwen API integration

---

## Pre-Deployment Checklist

### 1. GitHub Secrets Configured
Verify these secrets exist in the repo (Settings → Secrets and variables → Actions):

- ✅ `CLOUDFLARE_API_TOKEN` — Account-level Cloudflare API token (all permissions)
- ✅ `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID (32-char hex)
- ✅ `SUPABASE_URL` — Staging Supabase project URL
- ✅ `SUPABASE_KEY` — Supabase staging anon key
- ⚠️ `QWEN_API_KEY` (optional) — Alibaba Qwen API key (rules-based intent works without it)
- ⚠️ `WEBHOOK_SECRET` (optional) — HMAC-SHA256 key for X/Telegram webhooks

**Check:** `git push` will fail at the "Pre-deployment checks" step if CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID are missing.

### 2. Cloudflare Staging Environment Ready
Before deploying, verify staging is reachable:

```bash
# Check staging endpoint (replace with your subdomain)
curl https://core-brain-staging.mpt.workers.dev/health

# Expected response (before first deploy):
# 404 (Worker not deployed yet) — this is fine
```

### 3. Supabase Staging Database Ready
Verify the staging Supabase project has the required tables:

```sql
-- Run in Supabase SQL editor (staging project)
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public';

-- Expected tables:
-- - mpt_scan_events (webhook events)
-- - mpt_classifications (intent + risk scoring)
-- - mpt_responses (templated responses)
-- - mpt_firestore_logs (event logging)
```

---

## Deployment Steps

### Step 1: Review & Merge MPC-7257 PR

```bash
# View the PR diff
git show feat/mpc-7257-staging-deploy

# Key changes:
# - .github/workflows/deploy.yml: Optional secret handling for staging
# - workers/core-brain/: Worker + intent classification logic
# - tests/integration/staging.test.ts: Full integration test suite
```

**Checklist:**
- [ ] All CI tests pass (npm test)
- [ ] Linting passes
- [ ] No unresolved merge conflicts

### Step 2: Trigger Deployment via GitHub Actions

**Option A: Merge to main (auto-deploy)**
```bash
git push origin feat/mpc-7257-staging-deploy
# Create PR → approve → merge to main
# GitHub Actions automatically deploys on push to main
```

**Option B: Manual workflow_dispatch (for testing)**
```bash
# From the GitHub UI:
# 1. Go to Actions → "Deploy core-brain & social-listeners"
# 2. Click "Run workflow" → select branch → "Run workflow"
# This bypasses the commit push and runs the workflow immediately
```

### Step 3: Monitor Deployment Progress

1. **Navigate to GitHub Actions:**
   - Repo → Actions → "Deploy core-brain & social-listeners"
   - Watch the run for your commit

2. **Expected workflow steps:**
   ```
   ✅ test (ubuntu-latest)
      └─ npm install
      └─ npm test (should complete in <2m)
   
   ✅ deploy (matrix strategy: [core-brain, social-listeners])
      └─ Pre-deployment checks (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)
      └─ Deploy core-brain
         └─ Sync secrets (SUPABASE_URL, SUPABASE_KEY, optional: QWEN_API_KEY, WEBHOOK_SECRET)
         └─ wrangler deploy (publish to *.staging.workers.dev)
      └─ Deploy social-listeners
         └─ wrangler deploy
   ```

3. **Expected total time:** 5–10 minutes

### Step 4: Verify Staging Deployment

Once GitHub Actions completes, verify the Worker is live:

```bash
# Get the staging endpoint (check Cloudflare dashboard or wrangler output)
STAGING_URL="https://core-brain-staging.mpt.workers.dev"

# Health check
curl -X GET "${STAGING_URL}/health" \
  -H "Content-Type: application/json"

# Expected response:
{
  "configured": true,
  "version": "1.0.0",
  "timestamp": "2026-10-07T15:20:00.000Z"
}
```

---

## Integration Testing

### Run Full Integration Test Suite

```bash
# Install dependencies
npm install

# Run staging integration tests
npm run test:staging

# Expected output:
# ✓ Health check (passed)
# ✓ X webhook ingestion (passed)
# ✓ X intent classification (passed)
# ✓ X invalid signature rejection (passed)
# ✓ Telegram webhook ingestion (passed)
# ✓ Telegram intent classification (passed)
# ✓ Response templating (passed)
# ✓ Risk escalation (passed)
# ✓ Error handling — malformed JSON (passed)
# ✓ Error handling — missing fields (passed)
# ✓ Error handling — long payloads (passed)
# ✓ Firestore logging (passed)
#
# 12 tests passed in 45s
```

### Manual Test: X Webhook

```bash
# Generate webhook signature
PAYLOAD='{"for_user_id":"12345","data":{"id":"test-1","text":"I want to remove my data","author_id":"98765","created_at":"2026-10-07T15:20:00Z"}}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "test-secret" | sed 's/^.* //')

# Send webhook to staging
curl -X POST "https://core-brain-staging.mpt.workers.dev/webhook/x" \
  -H "Content-Type: application/json" \
  -H "X-Signature: ${SIGNATURE}" \
  -d "$PAYLOAD"

# Expected response:
{
  "event_id": "evt-20261007-xyz123",
  "intent": "REMOVAL_REQUEST",
  "confidence": 0.87,
  "risk_score": 62,
  "response_template": {
    "type": "REMOVAL_INSTRUCTIONS",
    "personalized_message": "Hi there, thank you for reaching out..."
  }
}
```

### Manual Test: Telegram Webhook

```bash
PAYLOAD='{"update_id":123456789,"message":{"message_id":1,"date":'$(date +%s)',"chat":{"id":987654321,"type":"private"},"text":"How do I remove my data?"}}'
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "test-secret" | sed 's/^.* //')

curl -X POST "https://core-brain-staging.mpt.workers.dev/webhook/telegram" \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: ${SIGNATURE}" \
  -d "$PAYLOAD"

# Expected response: 202 Accepted + intent classification
```

---

## Validation Checklist

After successful deployment, verify:

- [ ] Health check returns `configured: true` with no errors
- [ ] X webhook accepts valid signatures and rejects invalid ones (401)
- [ ] Telegram webhook ingests messages and classifies intent
- [ ] Intent classification produces: intent, confidence, risk_score
- [ ] Risk scoring correctly escalates high-risk queries (identity theft, fraud keywords)
- [ ] Response templating personalizes messages (name substitution, platform-specific formatting)
- [ ] Long payloads (10KB+) are handled gracefully (202 or 413, not 500)
- [ ] Malformed JSON is rejected (400, not 500)
- [ ] All integration tests pass (`npm run test:staging`)

**Validation checklist passed? ✅ Ready for production promotion.**

---

## Rollback Procedure

If the staging deployment has a critical issue, rollback to the previous version:

### Quick Rollback (Cloudflare Dashboard)
1. **Cloudflare Dashboard** → Workers → core-brain
2. **Deployments** tab → select the previous (green) deployment
3. **Rollback** → confirm

### Git Rollback (Safest)
```bash
# Find the last known-good commit
git log --oneline | head -20

# Revert the problematic commit
git revert <commit-sha-of-mpc-7257>

# Push to main to auto-deploy the revert
git push origin main
```

**Estimated time:** 2–5 minutes for Cloudflare to propagate

---

## Troubleshooting

### Issue: Deployment fails at "Pre-deployment checks"
**Cause:** Missing `CLOUDFLARE_API_TOKEN` or `CLOUDFLARE_ACCOUNT_ID` secret

**Fix:**
```bash
# Add missing secret to GitHub
# Settings → Secrets and variables → Actions → New repository secret
# Name: CLOUDFLARE_API_TOKEN
# Value: <your-account-level-token>
```

### Issue: Worker responds with 500 on webhook POST
**Cause:** Supabase connection failed or Worker runtime error

**Check:**
1. Worker logs in Cloudflare Real-Time Logs:
   ```bash
   wrangler tail --format pretty
   ```
2. Verify Supabase credentials in GitHub secrets
3. Check Supabase Edge Functions logs (if applicable)

### Issue: Webhook signature validation fails (401)
**Cause:** Signature mismatch (payload encoding or secret key)

**Check:**
1. Confirm `WEBHOOK_SECRET` matches the signing key used in webhook generation
2. Verify payload encoding (JSON must be compact, no whitespace)
3. Test with the included `generateWebhookSignature()` helper in integration tests

### Issue: Intent classification returns unexpected intent
**Cause:** Qwen model not responding (if QWEN_API_KEY missing, falls back to rules-based)

**Check:**
1. If `QWEN_API_KEY` is set, verify the key is active on Alibaba Dashboard
2. Verify text is in supported language (English supported; others may fail)
3. Review rule-based fallback in `index.ts` (should always return an intent)

---

## Monitoring & Observability

### Real-Time Logs (Cloudflare)
```bash
# Stream logs from the Worker
wrangler tail --format pretty

# Expected output:
# "POST /webhook/x HTTP/1.1" 202 Accepted
# "Classification: REMOVAL_REQUEST, confidence=0.87"
```

### Firestore Event Logging
Once deployed, all webhook events are logged to Firestore (`mpt_classifications` collection):

```js
// Query logged classifications
const classifications = await db.collection('mpt_classifications')
  .where('timestamp', '>=', new Date(Date.now() - 3600000)) // Last hour
  .get();

classifications.forEach(doc => {
  console.log(doc.data());
  // { event_id, intent, confidence, risk_score, timestamp }
});
```

### Grafana Dashboard (Optional)
If Grafana is configured, add a panel:
```sql
SELECT
  COUNT(*) as event_count,
  intent,
  AVG(risk_score) as avg_risk
FROM mpt_classifications
WHERE timestamp >= now() - interval '1 hour'
GROUP BY intent
```

---

## Success Criteria

✅ **Deployment successful when:**
1. GitHub Actions run completes with all steps green
2. Health check endpoint responds with `configured: true`
3. All integration tests pass (npm run test:staging)
4. Webhook POST requests are accepted (202 Accepted)
5. Intent classification produces expected intents + confidence scores
6. Firestore logging is capturing events

**Next step:** Promote staging to production (via separate MPC task).

---

## Contacts & Escalation

- **Deployment issues:** Check GitHub Actions logs → file MPC task
- **Cloudflare issues:** Cloudflare Support (Settings → Support)
- **Supabase issues:** Supabase Support dashboard
- **Qwen API issues:** Alibaba DashScope support

---

**Runbook version:** MPC-7257 v1.0  
**Last updated:** 2026-10-07  
**Owner:** MyPrivacyToolClaw
