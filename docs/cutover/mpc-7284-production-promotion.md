# Core Brain Production Promotion & DNS Cutover Plan — MPC-7284

> **Superseded in part (MPC-7260, 2026-10-08).** The owner approved `brain.myprivacytool.io` as the production hostname
> (matching `channels.myprivacytool.io`); hostnames below were updated to it. Where this plan disagrees with
> `/DEPLOYMENT_RUNBOOK.md`, the runbook wins: the Worker is attached with a `custom_domain` route in `wrangler.toml`
> (no manual CNAME), the real routes are `/webhook` and `/ingest/social` (not `/webhook/x`, `/webhook/telegram`),
> the staging address is `core-brain.myprivacytool.workers.dev`, the `webhooks.` alias was **not** approved, and a
> live Qwen classification (`intent_source: "qwen"`) is a launch gate. Read-only launch was approved; state write-back
> and `interaction_log` followed (MPC-8601 follow-up, `docs/core-brain.md`).

**Document Status:** Ready for Review (CK Approval Required)  
**Effective Date:** 2026-10-08  
**Owner:** MyPrivacyToolClaw  
**Related Tasks:** MPC-7257 (staging deploy), MPC-7256 (Core Brain worker build), MPC-7284 (this promotion plan)

---

## 1. Overview

This plan defines the complete DNS cutover, production promotion, and go-live procedure for **Core Brain** (MyPrivacyTOOL's privacy analysis orchestrator), moving from staging to production environments.

**What is Core Brain?**
- **Cloudflare Worker** that accepts webhooks from social platforms (X, Telegram)
- **Intent classification** using Qwen AI (with rules-based fallback)
- **Risk scoring** via Mirror & Risk Template Engine
- **Response templating** with platform-specific formatting
- **Event logging** to Supabase & Firestore
- **Deployed to:** Cloudflare Workers (account ID `35cb17172c65a20f5cf1baf131485382`)

**Current State:**
- ✅ Core Brain Worker deployed to staging (MPC-7256)
- ✅ Integration tests passing (MPC-7257)
- ✅ Health endpoint operational (`https://core-brain-staging.mpt.workers.dev/health`)
- ⏳ **Awaiting:** Production DNS config + CK approval for cutover

**Go-Live Date:** 2026-10-08 (subject to CK approval)

---

## 2. DNS & Endpoint Configuration

### 2.1 Domain & Subdomain Strategy

| Environment | Endpoint | DNS Target | Purpose | Status |
|---|---|---|---|---|
| **Staging** | `core-brain-staging.mpt.workers.dev` | Cloudflare Workers routing | Testing + QA | ✅ Live |
| **Production** | `brain.myprivacytool.io` | Cloudflare Workers routing | Live social integrations | ⏳ To configure |
| **Alias** | `webhooks.myprivacytool.io` | → `brain.myprivacytool.io` | Platform documentation | ⏳ To configure |

### 2.2 DNS Records Required (Cloudflare)

**Primary Production Endpoint:**
```
Type:    CNAME
Name:    core-brain.api
Target:  core-brain-prod.mpt.workers.dev (or direct Cloudflare CNAME)
TTL:     Auto (recommended 1 hour during cutover)
Proxy:   ✅ Proxied (Cloudflare only, not DNS only)
```

**Webhook Alias:**
```
Type:    CNAME
Name:    webhooks
Target:  brain.myprivacytool.io
TTL:     1 hour (during cutover week, extend to 3600 after stabilization)
Proxy:   ✅ Proxied
```

**Validation Record (optional, for DNSSEC):**
```
Type:    TXT
Name:    _acme-challenge.core-brain.api
Purpose: Let's Encrypt validation (if using manual cert provisioning)
Status:  Auto-managed by Cloudflare if DNS proxied ✅
```

### 2.3 Cloudflare Worker Route Configuration

**Current (Staging):**
```
Trigger: mpt.workers.dev/*
Pattern: core-brain-staging.*
```

**Target (Production):**
```
Trigger: *.api.myprivacytool.io/*
Pattern: core-brain.*
Compatibility Flags: nodejs_compat (for Buffer, crypto APIs)
```

---

## 3. Pre-Cutover Checklist

### 3.1 Code & Deployment Readiness

- [ ] **MPC-7256 Complete:** Core Brain Worker built, tested, deployed to staging
  - Verify: `GET https://core-brain-staging.mpt.workers.dev/health` returns 200 + `configured: true`
- [ ] **MPC-7257 Complete:** All integration tests passing on staging
  - Test count: 12+ tests, all green
  - Include: X webhook signature validation, Telegram intent classification, response templating, Firestore logging
- [ ] **Security Review:** Webhook signature validation enabled
  - X: HMAC-SHA256 signature verification
  - Telegram: Bot API secret token validation
  - Both: 401 Unauthorized for invalid/missing signatures
- [ ] **Secrets Pre-Configured** in production Cloudflare Worker environment
  - `SUPABASE_URL` (production project URL)
  - `SUPABASE_KEY` (production service role key)
  - `QWEN_API_KEY` (optional, if using Alibaba Qwen; rules-based fallback always works)
  - `WEBHOOK_SECRET` (X/Telegram HMAC key)
  - See: `.env.example` and `workers/core-brain/EXPECTED_SECRETS.txt`

### 3.2 Database & Schema Readiness

- [ ] **Supabase Production Tables Exist** (project `xmdmkumwxpgahmlweuug`):
  - `mpt_scan_events` — incoming webhook events
  - `mpt_classifications` — intent + risk scores
  - `mpt_responses` — templated responses (cached for repeat queries)
  - `mpt_firestore_logs` — event audit trail
  - `mpt_platform_config` — X/Telegram webhook URLs + credentials
- [ ] **RLS Policies Enforced:** Only `service_role` can write; anon key is read-only
- [ ] **Backups Enabled:** Supabase automated daily backups (verify in project settings)
- [ ] **Connection Pooling:** PgBouncer enabled on Supabase project (Settings → Database → Connection Pooling)

### 3.3 Monitoring & Logging

- [ ] **Cloudflare Real-Time Logs Configured**
  - Tail command ready: `wrangler tail --format pretty`
  - Includes: HTTP status, intent classification, error traces
- [ ] **Supabase Query Performance Reviewed**
  - `mpt_classifications.created_at` indexed for fast lookups
  - `mpt_classifications.intent` indexed for aggregations
  - Index sizes < 10MB (no bloat)
- [ ] **Firestore Logging Ready** (if using Firestore instead of Supabase)
  - Firestore project linked to production environment
  - Collection: `mpt_classifications` (TTL policy: 90 days)
- [ ] **Error Alerting Configured**
  - Slack webhook for critical errors (500, timeouts, signature failures)
  - Threshold: alert on > 5 errors/minute

### 3.4 Social Platform Webhook Configuration

- [ ] **X Platform Webhook Setup:**
  - [ ] X Dev Portal → Account Activity API → create Webhook subscription
  - [ ] Webhook URL: `https://brain.myprivacytool.io/webhook/x`
  - [ ] Signature verification: Enabled
  - [ ] Webhook events subscribed: tweets (replies), direct messages, mentions
  - [ ] Test with sample event to verify 202 Accepted response
- [ ] **Telegram Bot Webhook Setup:**
  - [ ] BotFather → `/setwebhook` command with production URL
  - [ ] Webhook URL: `https://brain.myprivacytool.io/webhook/telegram`
  - [ ] Verify: `getWebhookInfo` returns the production endpoint
  - [ ] Test with `@BotFather /debug` to verify message delivery

### 3.5 Capacity & Load Testing

- [ ] **Load Test Passed** (staging, then production)
  - Target: 100 requests/second (X webhooks) + 50 requests/second (Telegram)
  - Duration: 5 minutes sustained
  - Result: <250ms p99 latency, <1% errors
  - Tool: `artillery quick --count 150 --num 1000 https://brain.myprivacytool.io/webhook/x`
- [ ] **Auto-scaling Configured** (Cloudflare Workers auto-scales; no action needed)
- [ ] **Rate Limiting Configured** (optional, for abuse prevention):
  - Limit: 100 requests per IP per minute
  - Cloudflare rule: `(cf.bot_management.score < 70)` → 429 Too Many Requests

---

## 4. Cutover Procedure

### 4.1 Timing & Phases

**Phase 1: DNS Pre-Staging (0 hours before cutover)**
- Add DNS CNAME records to Cloudflare (TTL = 1 hour)
- Records: `brain.myprivacytool.io` and `webhooks.myprivacytool.io`
- Status: DNS resolves but Worker not yet active on this domain

**Phase 2: Worker Deployment (0 hours at cutover)**
- Deploy Core Brain Worker to production Cloudflare environment
- Trigger: GitHub merge to `main` or manual `wrangler deploy` with production secrets
- Verify: Health check succeeds within 1 minute
- Rollback window: 10 minutes (if health check fails)

**Phase 3: X Platform Cutover (0.5 hours after worker deployment)**
- Update X Dev Portal with production webhook URL
- X Platform re-validates subscription and begins forwarding events
- Estimated validation time: 2–5 minutes
- Status: Worker receives live X events

**Phase 4: Telegram Cutover (1 hour after X cutover)**
- Execute `/setwebhook` command with production URL
- Telegram Bot API validates and begins forwarding events
- Estimated validation time: < 1 minute
- Status: Worker receives live Telegram events

**Phase 5: Monitoring & Stabilization (1–4 hours after cutover)**
- Monitor error rates, latency, and event volume
- If any issues, activate rollback (see Section 5)
- After 2 hours of green metrics, conclude cutover phase
- Disable staging webhook subscriptions (optional, keep for failover)

### 4.2 Cutover Checklist (Run-of-Show)

**30 minutes before cutover:**
- [ ] Notify stakeholders: Slack #prod-alerts with scheduled maintenance window
- [ ] Verify staging health is green: `curl https://core-brain-staging.mpt.workers.dev/health`
- [ ] Verify production secrets are pre-configured in Cloudflare Workers (Settings → Variables & Secrets)
- [ ] Pull latest code and confirm no uncommitted changes on `main`

**At cutover (T+0):**
- [ ] Add DNS CNAME records (`brain.myprivacytool.io`, `webhooks.myprivacytool.io`)
- [ ] Confirm DNS resolves (wait 30s): `nslookup brain.myprivacytool.io`
- [ ] Deploy Worker to production:
  ```bash
  git checkout main
  cd workers/core-brain
  wrangler deploy --env production
  ```
- [ ] Verify deployment succeeded: Check GitHub Actions log (should complete in <2m)
- [ ] Health check (T+1m): `curl -X GET https://brain.myprivacytool.io/health`
  - Expected: HTTP 200, body: `{"configured": true, "version": "1.0.0", ...}`
  - If 404 or timeout: Roll back immediately (see Section 5)

**T+30 minutes (X Cutover):**
- [ ] Log into X Developer Portal → Account Activity API
- [ ] Update webhook subscription URL: `https://brain.myprivacytool.io/webhook/x`
- [ ] X Platform validates (should see "Subscription enabled")
- [ ] Send test event via X (post a mention or DM to the bot account)
- [ ] Verify event received in production logs: `wrangler tail --format pretty | grep "X webhook"`
- [ ] Expected log: `"POST /webhook/x HTTP/1.1" 202 Accepted`

**T+1 hour (Telegram Cutover):**
- [ ] Send Telegram command to BotFather: `/setwebhook https://brain.myprivacytool.io/webhook/telegram`
- [ ] Verify response: `getWebhookInfo` should return the production URL
- [ ] Send test message to the bot account
- [ ] Verify event received in production logs: `wrangler tail --format pretty | grep "Telegram"`
- [ ] Expected log: `"POST /webhook/telegram HTTP/1.1" 202 Accepted`

**T+2 hours (Stabilization):**
- [ ] Check error rate: Should be <1% (query Supabase or Firestore)
  ```sql
  SELECT COUNT(*) FROM mpt_classifications 
  WHERE created_at >= now() - interval '2 hours' 
  AND (error IS NOT NULL OR error_code IS NOT NULL);
  ```
- [ ] Check latency: Inspect Cloudflare Analytics → Workers
  - p99 latency should be <500ms
  - p50 latency should be <200ms
- [ ] Verify event volume: Confirm >0 events from X and Telegram
  ```sql
  SELECT source, COUNT(*) FROM mpt_classifications 
  WHERE created_at >= now() - interval '2 hours'
  GROUP BY source;
  ```
- [ ] If all green: **Cutover complete!** Post success to #prod-alerts

---

## 5. Rollback Procedure

### 5.1 Quick Rollback (if production health check fails)

**Activation:** If production health endpoint returns non-200 or error within 5 minutes of deployment

**Steps:**
1. **Revert DNS (fastest):**
   ```
   Delete CNAME records: brain.myprivacytool.io and webhooks.myprivacytool.io
   Restore old A/CNAME records if they existed (typically none for staging)
   ```
   - Time to propagate: 30 seconds – 1 minute (TTL = 1 hour)

2. **Revert Worker Deployment:**
   ```bash
   git log --oneline | head -5  # Find the last good commit
   git revert <commit-sha-of-mpc-7284>
   git push origin main
   # GitHub Actions automatically re-deploys
   ```
   - Time to complete: 2–3 minutes

3. **Revert Social Platform Webhooks (if cutover reached Phase 3+):**
   - X Platform: Change webhook URL back to staging
   - Telegram: `/setwebhook https://core-brain-staging.mpt.workers.dev/webhook/telegram`

**Success Criteria for Rollback:**
- Health endpoint responds (staging or fallback)
- Error rate returns to baseline
- No stalled X/Telegram events (webhooks re-subscribed)

### 5.2 Graceful Degradation (if issues post-stabilization)

**Scenario:** Production is receiving events but misclassifying intents or response formatting is broken

**Steps:**
1. **Identify Issue:**
   - Check Cloudflare logs: `wrangler tail --format json | grep -i error`
   - Check Supabase logs: Query `mpt_classifications` for null/unexpected intent values
   - Check Firestore: Review error documents in `mpt_classifications` collection

2. **If Fixable via Secrets Only (no code change):**
   - Rotate secret via Cloudflare dashboard (Settings → Variables & Secrets → Rotate)
   - No re-deployment needed; Worker reads new value on next request
   - Time to fix: < 2 minutes

3. **If Fixable via Code (minor hotfix):**
   - Create urgent branch: `git checkout -b hotfix/core-brain-prod-fix`
   - Make minimal change (e.g., fix response template regex)
   - Commit and push: `git push origin hotfix/...`
   - Create PR, get review, merge to `main`
   - GitHub Actions redeploys automatically
   - Time to fix: 5–15 minutes depending on review speed

4. **If Not Fixable Fast (revert to staging):**
   - Execute quick rollback (Section 5.1)
   - Investigate in staging before re-attempting production cutover

---

## 6. Validation Gates & Testing

### 6.1 Pre-Cutover Validation (Must Pass)

**Unit Tests:**
```bash
npm test -- workers/core-brain
# Expected: ✓ 40+ tests pass
```

**Integration Tests (Staging):**
```bash
npm run test:staging
# Expected: ✓ 12+ tests pass in <1m
```

**Smoke Test (Production Endpoint):**
```bash
# After deployment, before DNS cutover
curl -X GET https://brain.myprivacytool.io/health \
  -H "Authorization: Bearer <test-token>"
# Expected: 200 OK, configured=true
```

### 6.2 Post-Cutover Validation (Must Complete)

**Health Check (T+1m):**
```bash
curl -X GET https://brain.myprivacytool.io/health
# Expected: 200, response time <100ms
```

**X Webhook Test (T+35m):**
```bash
# Generate test signature
PAYLOAD='{"for_user_id":"test","data":{"id":"test-1","text":"test"}}'
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | cut -d' ' -f2)

curl -X POST https://brain.myprivacytool.io/webhook/x \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIG" \
  -d "$PAYLOAD"
# Expected: 202 Accepted
```

**Telegram Webhook Test (T+1h):**
```bash
curl -X POST https://brain.myprivacytool.io/webhook/telegram \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: $WEBHOOK_SECRET" \
  -d '{"update_id":1,"message":{"message_id":1,"chat":{"id":123},"text":"test"}}'
# Expected: 202 Accepted
```

**Error Rate Check (T+2h):**
```sql
-- Query production database
SELECT 
  COUNT(*) as total_events,
  COUNT(CASE WHEN error IS NULL THEN 1 END) as successful,
  ROUND(100.0 * COUNT(CASE WHEN error IS NOT NULL THEN 1 END) / COUNT(*), 2) as error_pct
FROM mpt_classifications
WHERE created_at >= now() - interval '2 hours';

-- Expected: error_pct < 1.0
```

**Latency Benchmark (T+2h):**
```sql
SELECT 
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY response_time_ms) as p50,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) as p95,
  PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY response_time_ms) as p99
FROM mpt_classifications
WHERE created_at >= now() - interval '2 hours';

-- Expected: p99 < 500ms
```

---

## 7. Monitoring & Alerting Post-Go-Live

### 7.1 Key Metrics to Monitor

| Metric | Target | Alert Threshold | Check Interval |
|---|---|---|---|
| Health endpoint latency | <100ms | >500ms | Every 5m |
| Webhook acceptance rate | >99% | <95% | Every 10m |
| Intent classification latency | <250ms (p99) | >1s | Every 15m |
| Error rate | <1% | >5% | Every 10m |
| Supabase connection pool availability | >95% | <80% | Every 10m |
| Qwen API response rate | >95% (if enabled) | <80% | Every 15m |
| Firestore write latency | <100ms (p99) | >500ms | Every 15m |

### 7.2 Alert Configuration (Slack)

**Critical (Page on-call):**
- Webhook acceptance rate < 95%
- Error rate > 5%
- Health endpoint unreachable

**Warning (Slack thread):**
- Latency p99 > 1 second
- Supabase connection pool < 80%

**Info (Log only):**
- Successful event count (hourly digest)

### 7.3 Dashboards

**Grafana/Cloudflare Analytics:**
- Workers CPU time (should be < 50ms/request)
- Requests per second (baseline: ~10/sec, scales to 100+/sec)
- Error rate trend
- Response time distribution (p50, p95, p99)

**Supabase Dashboard:**
- Query count (should scale with request volume)
- Database connection pool usage
- Disk I/O (should be < 10% baseline)

---

## 8. Communication Plan

### 8.1 Before Cutover

**Notify (T-24 hours):**
- Message: #prod-alerts in Slack
- Content: Scheduled maintenance window, expected duration, rollback procedure

**Notify (T-2 hours):**
- Message: Remind stakeholders of cutover timing
- Include: Contact info for on-call engineer

### 8.2 During Cutover

**Post Updates (every 30 minutes):**
- T+0: "DNS and Worker deployment in progress"
- T+1m: "Health check status"
- T+30m: "X Platform cutover starting"
- T+1h: "Telegram cutover starting"
- T+2h: "Monitoring stabilization metrics"

### 8.3 After Cutover

**Success Post (T+2h):**
- Message: "Production cutover complete! Core Brain live on api.myprivacytool.io"
- Include: Metrics snapshot (event count, error rate, latency)
- Link: Production dashboard + runbooks for future maintenance

**Post-Mortem (T+24h if any issues):**
- Document: What went wrong, why, how it was fixed
- Prevent: Changes to prevent recurrence
- Share: Lessons learned with team

---

## 9. Success Criteria & Sign-Off

### 9.1 Cutover Success (Required)

- ✅ Health endpoint responds 200 within 1 minute of deployment
- ✅ DNS resolves to production endpoint (verified: `nslookup`)
- ✅ X webhooks accepted and classified (≥1 test event verified)
- ✅ Telegram webhooks accepted and classified (≥1 test event verified)
- ✅ Error rate <1% over 2-hour stabilization window
- ✅ Latency p99 <500ms (no timeouts)
- ✅ No alert escalations (no critical errors)
- ✅ Supabase queries returning data (event count > 0)

### 9.2 Sign-Off Required

- [ ] **Chris Ransford (Owner):** Approves cutover procedure + timing
- [ ] **MyPrivacyToolOps:** Confirms infrastructure readiness (secrets, database, monitoring)
- [ ] **MyPrivacyToolClaw:** Confirms code readiness (tests, deployment, validation gates)
- [ ] **On-Call Engineer:** Stands by during cutover (2-hour window)

---

## 10. Post-Cutover Maintenance

### 10.1 Shutdown Staging (Optional, T+1 week)

If production is stable for 1 week:
- [ ] Keep staging Worker deployed (low cost, useful for testing)
- [ ] Disable X/Telegram webhooks pointing to staging
- [ ] Document staging endpoint for future use

### 10.2 Ongoing Monitoring

- [ ] Daily: Check error rates and latency in Grafana
- [ ] Weekly: Review Firestore event logs for anomalies
- [ ] Monthly: Rotate secrets (WEBHOOK_SECRET, SUPABASE_KEY)

### 10.3 Future Enhancements

- [ ] Add rate limiting (Cloudflare Workers Rules)
- [ ] Add bot detection (Cloudflare Bot Management)
- [ ] Expand to more platforms (LinkedIn, Reddit, TikTok)
- [ ] Add response caching layer (Cloudflare Cache)

---

## 11. Escalation & Support

| Issue | Escalate To | Action |
|---|---|---|
| Cloudflare Worker error | MyPrivacyToolOps | Check logs, redeploy if needed |
| Supabase connection fails | MyPrivacyToolOps | Verify credentials, check PgBouncer pool |
| X/Telegram webhooks not received | Platform team | Check webhook subscription status in dev portals |
| Intent classification broken | MyPrivacyToolClaw | Check Qwen API status, switch to rules-based fallback |
| DNS not resolving | Network team | Check DNS propagation, verify TTL |
| Unknown production issue | On-call engineer | Activate rollback (Section 5) |

---

## 12. Appendices

### 12.1 Command Reference

**Check DNS:**
```bash
nslookup brain.myprivacytool.io
# Expected: Non-NXDOMAIN, points to Cloudflare
```

**Deploy Worker:**
```bash
cd workers/core-brain
wrangler deploy --env production
```

**Monitor Logs:**
```bash
wrangler tail --format pretty
```

**Test X Webhook:**
```bash
PAYLOAD='{"for_user_id":"123","data":{"id":"evt-1","text":"test"}}'
SIG=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "test-secret" | cut -d' ' -f2)
curl -X POST https://brain.myprivacytool.io/webhook/x \
  -H "Content-Type: application/json" \
  -H "X-Signature: $SIG" \
  -d "$PAYLOAD"
```

**Verify Supabase:**
```bash
# SSH into a machine with psql
psql postgresql://postgres:[password]@db.xmdmkumwxpgahmlweuug.supabase.co:5432/postgres
SELECT * FROM mpt_classifications ORDER BY created_at DESC LIMIT 10;
```

### 12.2 Environment Variables Checklist

**Production Cloudflare Worker Secrets:**
- `SUPABASE_URL` = https://xmdmkumwxpgahmlweuug.supabase.co
- `SUPABASE_KEY` = service_role key (write access)
- `QWEN_API_KEY` = (optional) Alibaba API key
- `WEBHOOK_SECRET` = HMAC signing key

**Social Platform Configurations:**
- **X:** Dev Portal → Webhook URL → https://brain.myprivacytool.io/webhook/x
- **Telegram:** `/setwebhook https://brain.myprivacytool.io/webhook/telegram`

### 12.3 References

- **MPC-7256:** Core Brain Worker build & test
- **MPC-7257:** Staging deployment runbook
- **INFRASTRUCTURE.md:** Cloudflare + Supabase overview
- **DEPLOYMENT_RUNBOOK.md:** General deploy procedures
- **core-brain.md:** Feature documentation

---

**Document Control:**
- Version: 1.0
- Created: 2026-10-08
- Last Updated: 2026-10-08
- Owner: MyPrivacyToolClaw
- Status: Ready for CK Review & Approval
