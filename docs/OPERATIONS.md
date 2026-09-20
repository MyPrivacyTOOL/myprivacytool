# OPERATIONS — MyPrivacyTOOL

## Overview

This document defines how MyPrivacyTOOL is operated day-to-day: who does what, how decisions flow, what the deployment cadence is, and where to go when things break.

## Team Structure

| Role | Owner | Responsibility |
|------|-------|-----------------|
| **Hub / Orchestrator** | MyPrivacyToolClaw | Strategy, priorities, cross-team coordination |
| **Operations** | MyPrivacyToolOpsClaw | Infrastructure, deployments, uptime |
| **Marketing** | MyPrivacyToolMarketingClaw | Content, campaigns, lead generation |
| **Sales** | MyPrivacyToolSalesClaw | Pipeline, outreach, conversions |
| **Research** | MyPrivacyToolResearchClaw | Market intel, product research, competitive analysis |
| **Legal / Compliance** | MyPrivacyToolLegalClaw | T&Cs, privacy policy, regulatory compliance |
| **Finance** | MyPrivacyToolFinanceClaw | Revenue, costs, financial model |
| **Support** | MyPrivacyToolSupportClaw | Customer support, tickets, FAQs |
| **Analytics** | MyPrivacyToolAnalyticsClaw | Metrics, dashboards, KPI reporting |

## Decision Authority

### P0 (Irreversible, High Spend, Launches)
- **Authority**: Chris Ransford (KrispyKing)
- **Examples**: Product launch, major pricing changes, new market entry, partnerships >$50K
- **Flow**: Hub agent proposes via `ask_ck` tool → Chris decides → implement

### P1 (High Impact, <$50K Spend)
- **Authority**: Hub agent (MyPrivacyToolClaw) with Chris review
- **Examples**: Feature prioritization, campaign launch, vendor selection
- **Flow**: Hub agent proposes → Hub agent implements unless Chris objects within 3 days

### P2 (Routine, Low Risk)
- **Authority**: Assigned agent (specialist or sub-agent)
- **Examples**: Content scheduling, documentation, bug fixes, standard tasks
- **Flow**: Agent executes and reports results in task completion

## Deployment Cadence

| Environment | Frequency | Owner | Approval |
|-------------|-----------|-------|----------|
| **Development** | On commit | Engineers | None (feature branch) |
| **Staging** | Daily (0900 UTC) | Ops agent | None (auto-deploy from `main`) |
| **Production** | Weekly (Tue 0900 UTC, or as needed) | Ops agent | Hub agent sign-off |

**Process**:
1. Feature branch → PR → code review (≥1 approval)
2. Merge to `main` → auto-deploy to staging
3. Staging smoke tests (manual or automated) → pass/fail
4. On Tue 0900 UTC (or explicitly approved): promote staging → production
5. Monitor for 30 min post-deploy; roll back if critical issues

## Escalation Path

```
Issue arises
    ↓
Agent tries to resolve (3 attempts max)
    ↓
Cannot resolve? → create_escalation() + mark task Blocked
    ↓
Ops agent or Hub agent reviews
    ↓
Can fix? → fix it
    ↓
Cannot fix? → ask_ck() for decision/action
    ↓
Chris reviews and responds within 24h
```

## Monitoring & Alerts

- **Uptime**: Expect 99.5% (rolling 30-day SLA)
- **Response time**: p50 <500ms, p95 <2s
- **Error rate**: <0.1% of requests

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for alert escalation.

## Incident Response

**Critical incident** (prod down, data loss, security breach):
1. Page on-call immediately (see [CREDENTIALS.md](./CREDENTIALS.md) for contact)
2. Ops agent executes the [RUNBOOKS/critical-incident.md](./RUNBOOKS/critical-incident.md)
3. Hub agent notifies Chris
4. All hands on recovery; chat in `#incidents`

**Major incident** (prod degraded, feature broken):
1. Ops agent investigates and attempts fix
2. If unresolved after 30 min: escalate to Hub + Chris
3. Execute the appropriate runbook

**Minor incident** (non-prod, cosmetic):
1. Ops agent logs and schedules fix in next sprint

## Communications

- **Slack**: Real-time updates, incidents, quick decisions → `#incidents`, `#ops`, project channels
- **Notion**: Long-form decisions, task tracking, documentation → project hub
- **GitHub**: Code, deployment history, runbooks → this repo
- **Weekly standup**: Thu 1000 HKT (hub agent + key stakeholders)

## Feedback Loop

Every deploy, every incident, and every quarter:
1. Hub agent collects feedback
2. Document lessons in [DECISIONS.md](./DECISIONS.md)
3. Update this file if processes change
4. Share with team in standup

---

**Last updated**: 2026-09-20
**Next review**: 2026-10-20
