# DECISIONS — MyPrivacyTOOL Architecture & Strategic Log

This file records significant architecture decisions, trade-offs, and their rationale. Format follows ADR (Architecture Decision Record) style: **Decision** → **Context** → **Options** → **Chosen** → **Consequences**.

Use this file to:
- Understand **why** the system is built this way
- Avoid re-debating old decisions
- Onboard new contributors faster
- Track what changed and when

---

## Decision Template

```
### D-NNN | {Date} — {Title}

**Context**: Why this decision was needed.

**Options Considered**:
1. Option A — tradeoff (pro/con)
2. Option B — tradeoff (pro/con)
3. Option C — tradeoff (pro/con)

**Chosen**: Option X, because...

**Consequences**:
- Positive: ...
- Negative: ...
- Follow-up: ...
```

---

## Recent Decisions

### D-001 | 2026-09-20 — MVP on Cloudflare Pages (not self-hosted)

**Context**: Need fast, low-cost hosting for MVP; operations team is small.

**Options Considered**:
1. **Self-hosted VM** (GCP/AWS) — full control, higher ops burden, ~$50–100/month
2. **Cloudflare Pages** (JAMstack static + serverless) — managed, CDN included, easy deploys, scaling automatic
3. **Vercel / Netlify** — similar to CF Pages, slightly higher cost, less control

**Chosen**: Cloudflare Pages
- Pricing: $0 for first 500 deploys/month, then $0.30 per deploy (we'll do ~10/month) → effectively free
- No server ops needed; deploys are 2–3 min git-to-live
- Built-in CDN + DDoS protection
- Supabase handles all backend / DB logic

**Consequences**:
- Positive: Ops complexity near-zero; no VMs to manage; automatic scaling works
- Negative: Vendor lock-in to Cloudflare; JAMstack limits server-side logic (not an issue for MVP)
- Follow-up: When scaling beyond 1000 requests/sec, consider self-hosted or larger CF tier

---

### D-002 | 2026-09-15 — Supabase for Backend (PostgreSQL + Auth)

**Context**: Need database + user auth without building auth from scratch.

**Options Considered**:
1. **Firebase** — fully managed, limited SQL, pricey at scale, vendor lock-in
2. **Supabase** — Postgres + Auth + Realtime, open-source backend option, ~$25–100/month
3. **Self-hosted Postgres** — full control, ops overhead, harder to scale

**Chosen**: Supabase
- Battle-tested Postgres; can migrate later if needed
- Auth (email/OAuth) built-in; easy JWT integration with frontend
- Realtime subscriptions for future features (notifications, live dashboards)
- Cost predictable; pay per row / compute time

**Consequences**:
- Positive: No custom auth code; Postgres familiarity across team
- Negative: Supabase APIs have quirks; some features (advanced auth flows) need workarounds
- Follow-up: Document API quirks in codebase comments; plan migration path for future

---

### D-003 | 2026-08-30 — Stripe for Payments (not custom)

**Context**: Need PCI-compliant payments without PCI compliance burden.

**Options Considered**:
1. **Stripe** — fully managed, strong API, industry standard, 2.9% + $0.30 per transaction
2. **PayPal** — managed but limited API; less startup-friendly
3. **Custom (homegrown)** — zero commission, full PCI burden, >6 months of work

**Chosen**: Stripe
- Risk transfer: Stripe handles PCI, fraud, compliance
- Developer experience excellent; good webhook system
- Standard in startups; easy to hire engineers familiar with it

**Consequences**:
- Positive: Payment logic simple; focus on product, not compliance
- Negative: 2.9% fee (cost of business); Stripe API is sometimes opinionated
- Follow-up: Monitor chargeback rate; consider Stripe Radar for fraud prevention

---

### D-004 | 2026-09-10 — No Custom Analytics (GA4 + Notion)

**Context**: Need to track user behavior and product metrics without custom backend work.

**Options Considered**:
1. **Custom analytics** (homegrown events table + dashboards) — full control, 3+ months dev time
2. **GA4 + Notion dashboards** — quick setup, free tier covers MVP, limited real-time
3. **Mixpanel / Amplitude** — powerful but $1000+/month; overkill for MVP

**Chosen**: GA4 + Notion
- GA4 free tier covers 10M events/month; we'll do ~100K/month
- Notion integration for weekly reports + stakeholder views
- Can add custom analytics layer later if needed

**Consequences**:
- Positive: 0 custom code; Google maintains it
- Negative: Real-time dashboards take 24h lag; limited custom events
- Follow-up: Plan for custom event schema once product scales; migrate to Mixpanel if retention >500 users

---

### D-005 | 2026-09-20 — Git-Backed Operational Docs (not Notion-only)

**Context**: Operational knowledge was scattered (Notion + agent memory); hard to onboard, easy to lose.

**Options Considered**:
1. **Notion-only** — living docs, easy to edit, but not versioned; no PR review
2. **Git (GitHub) — versioned, reviewed in PRs, can be out of sync with operations
3. **Hybrid** — Git source of truth; Notion dashboards read from Git docs

**Chosen**: Git (docs/ in repo) with Notion task references
- Versioning: every doc change is a commit; can revert if wrong
- Review: operational changes reviewed in PR before live
- Discoverability: docs live with code; new engineers see them first

**Consequences**:
- Positive: Audit trail; change review; lives with code
- Negative: Requires discipline to keep in sync; one more tool
- Follow-up: Add automation to sync to Notion on merge; prevent docs drift

---

## Proposed / Pending Decisions

None currently.

---

## Retired Decisions

None yet (first sprint).

---

**Last updated**: 2026-09-20  
**Total decisions**: 5  
**Next review**: 2026-10-20
