# ROTATE-CREDENTIALS Runbook

**Use when**: Quarterly credential rotation (Q1/Q2/Q3/Q4) or after a known compromise  
**Estimated time**: 20–30 minutes per credential  
**Owner**: Ops agent (with Finance/Engineering for service-specific tokens)  
**Frequency**: Every 90 days for API keys; annually for OAuth secrets

---

## Pre-Rotation Checklist

**Before you start rotating ANY credential:**

- [ ] You have access to the relevant dashboard (Stripe, Sendgrid, etc.)
- [ ] You have AWS Secrets Manager access (to update values)
- [ ] **You have notified the team** (post in `#ops` or relevant channel)
  ```
  🔄 Starting credential rotation for [credential name]
  Service down time: [none / brief / specify]
  ETA: [X minutes]
  ```

---

## Rotation Steps (per credential)

### Step 1: Generate New Credential

**For Stripe API Key**:
1. Go to https://dashboard.stripe.com → Developers → API Keys
2. Click "Roll API Key" next to Live API Key
3. Copy the new key (save temporarily in a secure note app, NOT in Slack/Git)

**For Sendgrid API Key**:
1. Go to https://app.sendgrid.com → Settings → API Keys
2. Click "Create API Key"
3. Copy the key

**For GitHub Token**:
1. Go to https://github.com/settings/tokens
2. Click "Generate new token"
3. Scope: `repo`, `workflow` (if we use GitHub Actions)
4. Expiration: 1 year
5. Copy the token

**For Cloudflare API Token**:
1. Go to https://dash.cloudflare.com/profile/api-tokens
2. Click "Create Token" or "Roll" (if rotating existing)
3. Scope: Zone admin for myprivacytool zone (or account admin)
4. Copy the token

**For Others**: Check [CREDENTIALS.md](../CREDENTIALS.md) for the service-specific link

### Step 2: Test New Credential (Staging Only)

- [ ] **Update staging `.env` with new credential** (local only, do NOT commit)
  
- [ ] **Deploy to staging if applicable**
  - For payment: try a test transaction (use Stripe test card)
  - For email: send a test email
  - For API: make a test API call
  
- [ ] **Verify it works**
  - Old credential should still work (for now)
  - New credential works the same way
  
- [ ] **If test fails**: Revert and troubleshoot before production

### Step 3: Update Secrets in AWS

- [ ] **Go to AWS Secrets Manager**
  
- [ ] **Find the secret** (e.g., `myprivacytool/stripe_api_key`)
  
- [ ] **Click "New version"** or **"Update secret"**
  - Paste new credential value
  - Do NOT edit existing version; create a new one
  
- [ ] **Confirm update** (check version number increased)

### Step 4: Deploy to Production

- [ ] **Create a PR** if needed (usually just updating the deployment to pick up new secret)
  
- [ ] **Merge and deploy** (follow [DEPLOYMENT.md](../DEPLOYMENT.md))
  
- [ ] **Verify production is using new credential** (service works normally)

### Step 5: Deactivate Old Credential

**Wait 24 hours** before deactivating (in case rollback needed)

- [ ] Go back to the service dashboard (Stripe/Sendgrid/etc.)
  
- [ ] Find the old credential
  
- [ ] **Click Revoke / Deactivate / Delete**
  
- [ ] Confirm it's gone

### Step 6: Document

- [ ] **Update [CREDENTIALS.md](../CREDENTIALS.md)**
  - Set new "Last Rotated" date
  - Update status if applicable
  
- [ ] **Post in `#ops`**
  ```
  ✅ Credential rotation complete for [credential]
  Old credential deactivated
  All services working normally
  ```

---

## Special Cases

### Compromised Credential (Immediate Rotation)

- [ ] Do NOT wait 24 hours
- [ ] Generate new credential immediately
- [ ] Deploy to production same-day if possible
- [ ] Deactivate old credential immediately
- [ ] Create task: "Investigate how [credential] was exposed"

### Database Password Rotation (Supabase)

- [ ] Go to Supabase dashboard → Settings → Database → Change password
- [ ] Note new password (save in AWS Secrets Manager)
- [ ] Update application `.env` / Secrets Manager
- [ ] Test connection; then promote to prod

### OAuth Secret (Google/GitHub)

These rotate rarely (once/year typically):

- [ ] Go to Google Cloud Console / GitHub Settings
- [ ] Generate new client secret
- [ ] Update in AWS Secrets Manager
- [ ] **Redeploy** (frontend doesn't need to know, but backend should have new value)
- [ ] Test OAuth flow (Google Sign-In / GitHub Sign-In)
- [ ] Deactivate old secret

---

## Rollback (if rotation fails)

- [ ] **New credential not working?**
  
- [ ] **Revert to old credential** immediately
  - Update AWS Secrets Manager back to previous version
  - Deploy (redeploy same code)
  
- [ ] **Service should recover** (old credential still valid for 24 more hours)
  
- [ ] **Investigate why rotation failed**
  - Wrong scope?
  - Service not updated in time?
  - Wrong secret name in code?
  
- [ ] **Try rotation again** after fix is confirmed

---

## Quarterly Rotation Calendar

| Quarter | Credentials to Rotate | Owner |
|---------|----------------------|-------|
| Q1 (Jan) | All API keys + Google OAuth | Ops agent |
| Q2 (Apr) | All API keys | Ops agent |
| Q3 (Jul) | All API keys | Ops agent |
| Q4 (Oct) | All API keys | Ops agent |

**Tip**: Set calendar reminders 1 week before each quarterly window.

---

**Last updated**: 2026-09-20  
**Next scheduled rotation**: [Q4 2026 — see OPERATIONS.md](../OPERATIONS.md)
