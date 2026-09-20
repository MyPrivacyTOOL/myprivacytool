# CREDENTIALS — MyPrivacyTOOL

## Overview

This document inventories all credentials, API keys, and access tokens used by MyPrivacyTOOL. **Credential VALUES are never stored in this file or in Git** — this file holds metadata only: name, purpose, where the value lives, owner, and rotation schedule.

For actual credential values, see the secure storage location noted for each credential.

## Credential Inventory

### API Keys & Tokens

| Credential | Purpose | Storage Location | Owner | Rotation | Last Rotated | Status |
|------------|---------|------------------|-------|----------|--------------|--------|
| `STRIPE_API_KEY` | Payments processing | AWS Secrets Manager | Finance agent | Q | 2026-06-15 | ✓ Active |
| `STRIPE_WEBHOOK_SECRET` | Stripe event validation | AWS Secrets Manager | Finance agent | Q | 2026-06-15 | ✓ Active |
| `SENDGRID_API_KEY` | Email service | AWS Secrets Manager | Ops agent | Q | 2026-07-01 | ✓ Active |
| `SUPABASE_ANON_KEY` | Frontend DB access | `.env.public` (public-safe) | Ops agent | N/A | N/A | ✓ Public |
| `SUPABASE_SERVICE_KEY` | Backend DB admin | AWS Secrets Manager | Ops agent | Q | 2026-08-18 | ⚠️ See O2 |
| `GITHUB_TOKEN_MYPRIVACYTOOL` | Repo access (CI/CD) | AWS Secrets Manager | Ops agent | Q | ❌ 2026-06-22 | ⚠️ Expired |
| `CLOUDFLARE_API_TOKEN_MPT` | CDN/DNS management | AWS Secrets Manager | Ops agent | Q | 2026-08-30 | ✓ Active |
| `GOOGLE_ANALYTICS_VIEW_ID` | GA4 reporting | `.env` (local only) | Analytics agent | N/A | N/A | ✓ Public ID |
| `HUBSPOT_API_KEY` | CRM access | AWS Secrets Manager | Sales agent | Q | 2026-07-10 | ✓ Active |

### Database Credentials

| Credential | Purpose | Storage Location | Owner | Rotation | Status |
|------------|---------|------------------|-------|----------|--------|
| `DB_HOST` | Supabase Postgres | AWS Secrets Manager | Ops agent | N/A | ✓ |
| `DB_USER` | Supabase Postgres | AWS Secrets Manager | Ops agent | N/A | ✓ |
| `DB_PASSWORD` | Supabase Postgres | AWS Secrets Manager | Ops agent | Q | 2026-08-18 | ⚠️ See O2 |
| `DB_NAME` | Supabase database | `.env` (local only) | Ops agent | N/A | ✓ |

### OAuth / Third-Party Access

| Credential | Purpose | Provider | Owner | Rotation | Last Refreshed | Status |
|------------|---------|----------|-------|----------|----------------|--------|
| `GOOGLE_OAUTH_CLIENT_ID` | Google Sign-In | Google Cloud | Ops agent | N/A | N/A | ✓ |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google Sign-In | Google Cloud | Ops agent | 1/year | 2026-06-01 | ✓ |

## Access Control

### Who can access what

| Role | Can access | Storage | Method |
|------|-----------|---------|--------|
| **Ops agent** | All credentials | AWS Secrets Manager | AWS SDK + IAM role |
| **Hub agent** | None (queries ops agent) | N/A | N/A |
| **Engineers (local dev)** | Public keys + local `.env` | GitHub + local `.env.local` | Git + file |
| **CI/CD pipeline** | All (via service account) | AWS Secrets Manager | IAM role |

### Credential Access Procedure

1. **Need a credential?** Ask the **Ops agent** in Notion or Slack
2. **Ops agent** fetches from AWS Secrets Manager via `secretmanager_get_secret_version`
3. **Value is handed to you once** — never pasted in Git, Slack, or Notion
4. **Store locally in `.env.local`** (git-ignored) if running code locally
5. **Rotation**: Ops agent rotates every quarter; notify all users when new value goes live

## Known Issues & Actions (from STANDING_OBJECTIVES O2)

### ⚠️ Supabase secret key — unrotated
- **Current state**: Live, active secret key has been in use since 2026-06-15
- **Action needed**: Rotate in Supabase dashboard (Settings → API → generate new Service Role key)
- **Owner**: Chris Ransford (CK decision)
- **Handoff**: New key delivered to Ops agent via Remote Run relay, never pasted in chat

### ⚠️ GitHub token — expired
- **Current state**: `GITHUB_TOKEN_MYPRIVACYTOOL` returns 401 Bad Credentials
- **Action needed**: Refresh token or regenerate in GitHub Personal Access Tokens
- **Owner**: Chris Ransford or Ops agent (verify scope: repo, workflow)
- **Impact**: CI/CD may fail to push to repo or create releases

### ✓ Cloudflare token — compromised exposure closed
- **What happened**: Old token (`cfat_...bb43`) was committed to repo, then redacted
- **Current state**: Old token is dead (Cloudflare rejects it); exposure is closed
- **Live token**: `CF_API_TOKEN_MPT` in AWS Secrets Manager is valid and active (rotated 2026-08-30)

## Rotation Schedule

**Quarterly (Q1, Q2, Q3, Q4)**:
- `STRIPE_API_KEY` → Stripe dashboard
- `SENDGRID_API_KEY` → SendGrid dashboard
- `GITHUB_TOKEN_MYPRIVACYTOOL` → GitHub PAT settings
- `CLOUDFLARE_API_TOKEN_MPT` → Cloudflare dashboard
- `DB_PASSWORD` → Supabase dashboard
- `HUBSPOT_API_KEY` → HubSpot settings

**Annually**:
- `GOOGLE_OAUTH_CLIENT_SECRET` → Google Cloud Console (Jan)

**As-needed**:
- Any credential exposed or leaked
- Any service credential that shows suspicious activity
- After any team member offboarding

## Security Policy

1. **Never commit credentials to Git** — use `.env.local` (git-ignored) and AWS Secrets Manager for everything else
2. **Never paste credentials in Slack, Notion, or email** — hand off in person or via secure channel (e.g., Remote Run relay with file delivery)
3. **Rotate immediately if leaked** — run `git log --all -S <credential_snippet>` to audit history; contact security
4. **Use IAM roles, not static keys** — services should assume roles, not store keys
5. **Least privilege** — each service account / token should have only the permissions it needs

---

**Last updated**: 2026-09-20
**Next rotation review**: 2026-10-20 (Q4 quarterly rotation)
