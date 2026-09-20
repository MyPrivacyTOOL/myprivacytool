# DEPLOYMENT — MyPrivacyTOOL

## Overview

This document describes how code changes are tested, released, and deployed to production for MyPrivacyTOOL.

## Deployment Targets

| Environment | URL | Infrastructure | Uptime SLA | Owner |
|-------------|-----|-----------------|-----------|-------|
| **Development** | localhost:5173 | Local machine | N/A | Developer |
| **Staging** | staging.myprivacytool.io | Cloudflare Pages | 95% | Ops agent |
| **Production** | myprivacytool.io | Cloudflare Pages | 99.5% | Ops agent |

## Release Process

### 1. Feature Development

```
Feature branch (feat/*)
    ↓
Write code + tests
    ↓
Push to origin/feat/*
    ↓
Open PR (title: "feat: <description>")
    ↓
Code review (≥1 approval required)
    ↓
All checks pass (lint, tests)
```

**Checks required before merge**:
- ✓ GitHub Actions workflows pass (lint, type check, tests)
- ✓ ≥1 peer review approval
- ✓ No conflicts with `main`

### 2. Merge to Main

```
PR approved
    ↓
Merge to main (squash or rebase preferred)
    ↓
Auto-deploy to staging (triggered by Git push)
    ↓
Staging live within 2-3 minutes
```

**Who can merge**: Any team member with write access (no special gate).

### 3. Staging Testing

**Window**: After merge, before production deploy  
**Duration**: Minimum 4 hours, typically 1 business day

**Smoke tests** (manual or automated):
- [ ] Home page loads
- [ ] Exposure scan initiates
- [ ] User can sign up / sign in
- [ ] Payment form accepts test card
- [ ] Email sends (check SendGrid logs)
- [ ] GA4 events fire (check Analytics dashboard)

**If issues found**: Fix on new branch, re-merge, re-test in staging.

### 4. Production Deploy

**Approval**: Hub agent (`MyPrivacyToolClaw`) reviews and approves in Notion task  
**Timing**: Tuesdays 0900 UTC, or emergency as needed (≤30 min)

**Deploy command** (Ops agent):
```bash
cf_pages_trigger_deploy()
```

**Verification** (immediately post-deploy):
- [ ] myprivacytool.io loads
- [ ] Latest code is live (check footer version or console log)
- [ ] Key features work (scan, signup, payment)
- [ ] No spike in error rate (check Sentry or logs)
- [ ] User-facing text matches current brand (check [Brand Guidelines](../docs/README.md))

**Monitoring window**: 30 minutes  
**If critical issue**: Execute [rollback](#rollback-procedure) immediately

### 5. Post-Deploy

- Record deploy in [DECISIONS.md](./DECISIONS.md) with timestamp and what changed
- Notify team in Slack (`#incidents` or project channel)
- Monitor error rate and performance for 24 hours

## Rollback Procedure

**When**: Critical bugs in production that cannot be hot-fixed (e.g., payment broken, site down)  
**Approval**: Hub agent only (no waiting for Chris)  
**Execution time**: <5 minutes

```
Bug detected in prod
    ↓
Confirm via monitoring (Sentry errors, user reports, synthetic checks)
    ↓
Hub agent approves rollback in Slack or task
    ↓
Ops agent executes:
    cf_pages_rollback(deploymentId="<last_good_deploy_id>")
    ↓
Verify prod is back to last good version
    ↓
Post in #incidents: "Rolled back to [deployment] due to [issue]"
    ↓
Root cause analysis in task, document in DECISIONS.md
```

**Last known good deploy**: Stored in Cloudflare Pages deploy history (visible in CF dashboard).

## Emergency / Out-of-Cycle Deploy

**Scenario**: Critical security patch, data loss fix, or business-critical bug

**Process**:
1. Fix on feature branch + test in staging (same rigor as normal deploy)
2. Hub agent decides (ask_ck if needed) → approve emergency deploy
3. Ops agent merges to `main` and immediately triggers production deploy
4. Skip the Tuesday window; go straight to prod with monitoring

**Example**: "XSS vulnerability found in signup form → merge + deploy today"

## Deployment Checklist

Use this before every production deploy:

```
Pre-Deploy
  [ ] All changes are in main
  [ ] Staging has been live ≥4 hours with no critical issues
  [ ] Smoke tests pass
  [ ] Hub agent approval received
  [ ] On-call team is aware (Slack notification sent)

Deploy
  [ ] cf_pages_trigger_deploy() executed
  [ ] Deploy status shows "success"
  [ ] ~2 minute wait for CDN cache invalidation

Post-Deploy
  [ ] Prod URL loads and renders
  [ ] Key user flows work (signup, scan, checkout)
  [ ] Error rate normal (<0.1%)
  [ ] Monitor for 30 min
  [ ] Record deploy in DECISIONS.md
  [ ] Post deploy summary in Slack
```

## Monitoring & Alerts

**Real-time monitoring**:
- Sentry (error tracking) → prod errors
- Cloudflare Analytics → traffic, request rate, cache hit rate
- Custom dashboard (if available) → biz metrics (scans, signups, revenue)

**Alert thresholds**:
- Error rate >1% → page on-call
- Uptime <95% (1h rolling) → page on-call
- Sudden traffic spike (>3x normal) → investigate

**Response**:
1. Ops agent checks Sentry/logs
2. If fixable in <15 min: hot-fix + re-deploy
3. If not: execute rollback + root cause analysis

---

**Last updated**: 2026-09-20
**Deployment schedule**: Every Tuesday 0900 UTC (or emergency as needed)
