# TROUBLESHOOTING — MyPrivacyTOOL

## Common Issues & Recovery

### Site Won't Load (myprivacytool.io returns 502/503)

**Symptoms**: Users report site down or slow; Cloudflare dashboard shows high error rate

**Quick diagnosis**:
1. Check Cloudflare Pages dashboard for recent deploy status
2. Check if deploy completed successfully (green checkmark)
3. Check Sentry for app errors (if deployed)

**Recovery**:

| Cause | Fix |
|-------|-----|
| Recent bad deploy | Execute rollback (see [DEPLOYMENT.md](./DEPLOYMENT.md#rollback-procedure)) |
| Database down | Check Supabase dashboard; verify DB is online |
| DNS / CDN issue | Cloudflare support; check DNS records in dashboard |
| Static asset cache | Invalidate CDN cache (see [CREDENTIALS.md](./CREDENTIALS.md) for token) |

**Escalation**: If unresolved after 10 minutes → page on-call (see [OPERATIONS.md](./OPERATIONS.md#escalation-path))

---

### Payment Processing Fails (Stripe errors)

**Symptoms**: Users can't complete checkout; Stripe webhook errors in Sentry

**Quick diagnosis**:
1. Check Stripe dashboard: https://dashboard.stripe.com → Developers → Webhooks → recent events
2. Verify webhook secret matches `STRIPE_WEBHOOK_SECRET` in [CREDENTIALS.md](./CREDENTIALS.md)
3. Check Sentry for payment-related errors

**Common causes**:

| Error | Fix |
|-------|-----|
| "Invalid API key" | Verify `STRIPE_API_KEY` in AWS Secrets Manager; check expiration date |
| "Webhook signature verification failed" | Webhook secret mismatch; re-sync secret in code or update environment |
| "Rate limit exceeded" | Wait 1 min; Stripe is self-healing. Monitor for recurring issues |
| "Payment intent not found" | Race condition in code; check logs for timing issues |

**Recovery**:
1. Verify credentials in AWS Secrets Manager
2. Re-deploy with correct secret (if updated)
3. Monitor Stripe dashboard for recovery

**Escalation**: If payments still failing after 30 min → involve Finance agent + Chris

---

### High Error Rate / 5xx Errors in Sentry

**Symptoms**: Error rate >1%; users see "something went wrong" message

**Quick diagnosis**:
1. Go to Sentry project → Issues → recent errors (sort by frequency)
2. Click top error → view stack trace
3. Check if all recent deploys are live (compare commit SHA with Cloudflare)

**Common causes**:

| Error | Fix |
|-------|-----|
| "DB connection refused" | Supabase may be restarting; wait 2-3 min or restart connection pool |
| "Undefined is not a function" | Code error from recent deploy; check for type errors in deploy |
| "Rate limit / quota exceeded" | Third-party service (API) limit hit; wait or increase quota |
| "CORS error" | Frontend calling API with wrong origin; check CORS headers |

**Recovery**:
1. Check deploy status (last 2 deploys)
2. If recent deploy caused error: rollback
3. If intermittent: increase retries / circuit breaker timeout
4. If quota: upgrade third-party service or implement rate limiting

**Escalation**: Ongoing errors after rollback → create task for root cause analysis

---

### Email Not Sending (SendGrid issues)

**Symptoms**: Users don't receive welcome / password reset / notification emails

**Quick diagnosis**:
1. Check SendGrid dashboard: https://app.sendgrid.com → Email Activity
2. Filter by recipient email; look for bounces or delivery failures
3. Check Sentry for `sendgrid` errors

**Common causes**:

| Cause | Fix |
|-------|-----|
| Invalid API key | Re-verify `SENDGRID_API_KEY` in AWS Secrets Manager |
| Recipient email is bounced/invalid | Check SendGrid suppression list; verify recipient email format |
| DKIM/SPF not configured | Email domain not verified in SendGrid; contact Ops agent |
| Template missing | SendGrid template ID not found; check template IDs match deployment |

**Recovery**:
1. Verify API key in Secrets Manager
2. Resend manual test email from SendGrid dashboard
3. Check domain verification in SendGrid settings
4. If template issue: deploy new version with correct template ID

**Escalation**: If emails still failing → page on-call

---

### Database Performance Degradation

**Symptoms**: Queries slow (p95 > 2s); users report lag

**Quick diagnosis**:
1. Go to Supabase dashboard → Monitoring → Query Performance
2. Check slow query log (queries >1s)
3. Check DB connection count (should be <20)

**Recovery**:

| Issue | Fix |
|-------|-----|
| Slow query | Add index or rewrite query; document in DECISIONS.md |
| Connection pool exhausted | Increase pool size or optimize connection lifecycle |
| Storage full | Check DB usage; archive old data or upgrade tier |
| High CPU / memory | Scale up Supabase instance or optimize heavy queries |

**Escalation**: Performance >30 min unresolved → involve Ops + Finance (may need Supabase upgrade)

---

### Authentication / Login Broken

**Symptoms**: Users can't sign in; OAuth fails

**Quick diagnosis**:
1. Try signing in yourself: do you get an error message?
2. Check Sentry for auth-related errors
3. Check OAuth provider (Google/GitHub) status page

**Common causes**:

| Cause | Fix |
|-------|-----|
| OAuth secret expired | Rotate `GOOGLE_OAUTH_CLIENT_SECRET` (see [CREDENTIALS.md](./CREDENTIALS.md)) |
| CORS/redirect URI mismatch | Verify redirect URI in Google Cloud Console matches app URL |
| Session expired | Clear browser cache / cookies; try incognito mode |
| Provider down | Check Google / GitHub status page; wait for recovery |

**Recovery**:
1. Verify OAuth credentials in Google Cloud / GitHub
2. Test login flow in incognito mode
3. Clear cache if needed; try again

**Escalation**: If OAuth broken >10 min → page on-call

---

### Deployment Failed / Stuck

**Symptoms**: Cloudflare Pages shows "failed" deploy status; no ETA for recovery

**Quick diagnosis**:
1. Go to Cloudflare Pages dashboard → myprivacytool project → Deployments
2. Click failed deploy → view build logs
3. Look for error at end of log

**Common causes**:

| Error | Fix |
|-------|-----|
| Build failed | Fix code issue (lint / type error / missing dep) and re-push |
| GitHub access denied | Verify `GITHUB_TOKEN_MYPRIVACYTOOL` is valid (see [CREDENTIALS.md](./CREDENTIALS.md)) |
| Timeout (>30 min) | Check if large dependencies added; optimize build or increase timeout |

**Recovery**:
1. Fix code / credential issue
2. Force re-deploy: `cf_pages_trigger_deploy()`
3. Monitor build logs; should complete within 3-5 min

**Escalation**: If deploy still fails after retry → page on-call + create task for investigation

---

### CDN Cache Issue (Stale Content)

**Symptoms**: Users see old version of site; cache-busting not working

**Quick diagnosis**:
1. Open DevTools → Network → check `cache-control` header
2. Cloudflare dashboard → Caching → Cache Rules
3. Check if file hash in URL changed (for JS/CSS)

**Recovery**:
```
# Ops agent executes:
cdn_invalidate_cache(
  urlMap="myprivacytool.io",
  path="/*",  # Invalidate all
  host="myprivacytool.io"
)
```

**Expected**: CDN purge completes within 30 sec; fresh content served.

---

## Escalation Decision Tree

```
Issue detected
  ↓
  Is site completely down? (502/503/timeout)
    YES → Rollback + investigate
    NO  ↓
  Is it affecting >10% of users?
    YES → Follow recovery steps above + escalate to on-call
    NO  ↓
  Can it be fixed in <30 min?
    YES → Fix it + document in task
    NO  → Create Blocked task + ask_ck()
```

## Monitoring & Alerts

**Set up alerts for**:
- Error rate >1% (5 min window) → page on-call
- Uptime <95% (30 min rolling) → page on-call
- DB query p95 >2s → notify Ops agent
- Payment failure rate >0.5% → notify Finance + Sales

See [OPERATIONS.md](./OPERATIONS.md#monitoring--alerts) for alert channels and contact info.

## Getting Help

1. **Quick fix?** → Do it + document
2. **Unclear cause?** → Check Sentry + logs → search this file
3. **Still stuck?** → Create task + assign to Ops agent
4. **Urgent / critical?** → Page on-call immediately (Slack or phone)

---

**Last updated**: 2026-09-20
**Runbooks**: See [RUNBOOKS/](./RUNBOOKS/) for step-by-step procedures
