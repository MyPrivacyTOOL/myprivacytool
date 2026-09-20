# CRITICAL-INCIDENT Runbook

**Use when**: Site is completely down (502/503), payment processing is broken, or data is affected  
**Estimated time**: 15–45 minutes (depending on cause)  
**Owner**: Ops agent + Hub agent  
**Escalation**: Notify Chris immediately (see OPERATIONS.md for contact)

---

## Pre-Incident Setup (Do Once)

Before an incident happens, make sure you have:
- [ ] Access to Cloudflare Pages dashboard
- [ ] Access to Supabase dashboard
- [ ] Access to Sentry (error tracking)
- [ ] Slack channel `#incidents` created and monitored
- [ ] Phone numbers for on-call team (in CREDENTIALS.md)

---

## Incident Response Checklist

### 1. Assess the Situation (2–3 min)

- [ ] **Confirm the issue is real** (not just your browser cache)
  - Open myprivacytool.io in incognito mode
  - Try on different device/network if possible
  - Check Cloudflare status page for known issues
  
- [ ] **Document the symptoms**
  - What exactly is broken? (whole site / specific feature / payment)
  - What do users see? (error message / blank page / timeout)
  - When did it start? (check Cloudflare deploy time)
  
- [ ] **Check deploy status**
  - Go to Cloudflare Pages dashboard → Deployments
  - What's the status of the last 3 deploys? (success / failed / in progress)
  
- [ ] **Post initial alert in `#incidents`**
  ```
  🚨 CRITICAL: [service] is down
  Symptoms: [what's broken]
  Status: [investigating / rolling back / fixed]
  Last deploy: [timestamp]
  ```

### 2. Triage (3–5 min)

- [ ] **Check Sentry for recent errors**
  - Go to Sentry → Issues → sort by recent
  - Do you see a spike in errors? (error rate normally <0.1%, should be <1%)
  - What's the error? (database / code / third-party service)

- [ ] **Check if this is a recent deploy issue**
  - Compare current live deploy SHA with what's in prod
  - Was there a deploy in the last 30 min?
  - If YES → likely code issue; prepare for rollback

- [ ] **Check third-party service status**
  - Supabase: https://status.supabase.com
  - Stripe: https://status.stripe.com
  - Cloudflare: https://www.cloudflarestatus.com
  - SendGrid: https://status.sendgrid.com

- [ ] **Declare root cause (preliminary)**
  - Recent bad deploy
  - Database down / unhealthy
  - Third-party service issue
  - Unknown / needs deeper investigation

### 3. Execute Fix (3–30 min depending on cause)

**If: Recent bad deploy (most likely)**

- [ ] Go to Cloudflare Pages → Deployments → click previous good deploy
- [ ] Note the deployment ID (from URL or dashboard)
- [ ] Execute rollback:
  ```
  cf_pages_rollback(deploymentId="<deployment_id_of_last_good_deploy>")
  ```
- [ ] Wait for rollback to complete (~2–3 min)
- [ ] Verify prod is back to working state
- [ ] Post in `#incidents`: "Rolled back to [deployment] at [time]. Investigating cause."

**If: Database down or unhealthy**

- [ ] Go to Supabase dashboard → Status
- [ ] Is database showing as "active"? If not, wait for it to restart (usually 2–5 min)
- [ ] Try connecting via Supabase CLI to verify:
  ```
  supabase status  # if you have local access
  ```
- [ ] If DB still down after 10 min: contact Supabase support (check CREDENTIALS.md for account)
- [ ] If DB recovers: check if queries are slow (see TROUBLESHOOTING.md); may need restart

**If: Third-party service down**

- [ ] Check status page again (refresh)
- [ ] If status page says "investigating" → post in #incidents and wait
- [ ] If status page says "resolved" but issue persists → check credentials (see CREDENTIALS.md)
- [ ] Verify webhook URLs and secret keys are correct
- [ ] Contact service support if issue persists >15 min

**If: Unknown cause**

- [ ] Rollback the most recent deploy (safer than trying to debug live)
- [ ] Once site is back up: investigate root cause in staging/logs
- [ ] Do NOT deploy again until you know the cause

### 4. Verify Recovery (3–5 min)

- [ ] **Confirm site is up**
  - [ ] myprivacytool.io loads (not just homepage; try signup/scan flow)
  - [ ] Response time is normal (<1s)
  - [ ] No obvious errors in browser console

- [ ] **Check error rate**
  - [ ] Sentry error rate drops back to normal (<0.1%)
  - [ ] Cloudflare dashboard shows traffic returning

- [ ] **Quick smoke test**
  - [ ] Load homepage
  - [ ] Start an exposure scan
  - [ ] Try signup/login
  - [ ] Check payment form (if possible)

- [ ] **Post all-clear in `#incidents`**
  ```
  ✅ RESOLVED: [service] is back up
  Root cause: [what it was]
  Fix applied: [rollback / DB restart / credential fix]
  Recovery time: [X minutes]
  Follow-up: [investigation / fix / deploy]
  ```

### 5. Post-Incident (within 1 hour)

- [ ] **Create a Notion task** for root cause investigation
  - Title: "POST-INCIDENT: Investigate [incident name] — 2026-09-20"
  - Add timeline, what failed, and what we learned
  
- [ ] **Update TROUBLESHOOTING.md** if this is a new error we didn't have a fix for
  
- [ ] **Update DECISIONS.md** if the fix changes how we operate (e.g., "we now rollback immediately rather than wait")

- [ ] **Notify team**
  - Post summary in project channel (not just #incidents)
  - Include: when it happened, what broke, how long it took to fix, what we'll do to prevent it

- [ ] **Schedule a brief retro** (even 15 min) with team to discuss:
  - Did we respond fast enough?
  - What did we miss?
  - How do we prevent this again?

---

## Escalation Decision Tree

```
Issue confirmed
  ↓
  Is site completely unreachable (502/timeout)?
    YES → Rollback most recent deploy
    NO  ↓
  Did a deploy happen in last 30 min?
    YES → Rollback
    NO  ↓
  Is error rate spiking but site is still up?
    YES → Check Sentry; if clear bad deploy, rollback; else investigate
    NO  ↓
  Is a third-party service down?
    YES → Wait for them to recover; monitor
    NO  → Call for help; this is unusual
```

## Key Contacts

| Role | Contact | When to call |
|------|---------|-------------|
| **Ops agent** | [see CREDENTIALS.md] | Any incident response |
| **Hub agent** | [see CREDENTIALS.md] | Before/after incident, decisions |
| **Chris** | [see CREDENTIALS.md] | Critical incident >5 min unresolved |
| **Supabase support** | Account owner (Chris) | Database down >10 min |
| **Stripe support** | Account owner (Finance agent) | Payment processing broken |

---

**Last updated**: 2026-09-20  
**Runbook version**: 1.0  
**Last used**: Never (hopefully!)
