# ROLLBACK Runbook

**Use when**: A deployment to production caused a critical issue  
**Estimated time**: 5–10 minutes  
**Owner**: Ops agent (Hub agent approval required)  
**Prerequisite**: You know which deployment is "good" (from Cloudflare dashboard or chat history)

---

## Quick Rollback (High Confidence)

Use this if you're sure the current deploy is bad and the previous deploy was good.

- [ ] **Go to Cloudflare Pages dashboard**
  - Project: myprivacytool
  - Click Deployments
  
- [ ] **Find the last good deployment**
  - Scroll down; look for the most recent one with a ✓ (success)
  - Before the current failed/bad one
  - Note the deployment ID (shown in the URL or dashboard row)
  
- [ ] **Execute rollback**
  ```
  cf_pages_rollback(deploymentId="<good_deployment_id>")
  ```
  - Wait for the command to complete
  - Status should change to green / "promoted"
  
- [ ] **Verify**
  - [ ] myprivacytool.io loads without errors
  - [ ] No 502/503
  - [ ] Basic flows work (home → signup → scan)
  - [ ] Sentry error rate drops
  
- [ ] **Post in `#incidents`**
  ```
  ✅ Rolled back to [deployment_id] (from [timestamp])
  Issue: [what was broken]
  Recovery time: [X minutes]
  ```

- [ ] **Create investigation task**
  - Assign to responsible engineer
  - Include what went wrong and why it wasn't caught in staging

---

## Conservative Rollback (Uncertain)

Use this if you're not 100% sure which deployment is good, or if you want to check before rolling back.

- [ ] **Review the last 3 deployments**
  - Go to Cloudflare Pages → Deployments
  - Check the commits/changes for each
  - Which one was definitely working last?
  
- [ ] **Ask in `#incidents`**
  ```
  Considering rollback. Last 3 deployments:
  1. [ID] [commit] [time] [status]
  2. [ID] [commit] [time] [status]
  3. [ID] [commit] [time] [status]
  Which should we target?
  ```
  
- [ ] **Ops/Hub agent confirms**
  
- [ ] **Execute rollback** (see above)

---

## If Rollback Fails

- [ ] **Rollback did not work? That's unusual.**
  
- [ ] **Try rolling back further**
  - Go 2 or 3 deployments back (to a version you know worked)
  
- [ ] **If still failing: call for help**
  - Post in #incidents: "@Hub agent Rollback not working. Need escalation."
  - Contact Chris if urgent

---

## After Rollback

- [ ] **Confirm everything is stable (10–15 min)**
  - Error rate normal
  - No more user complaints
  - Monitoring looks healthy
  
- [ ] **Do NOT re-deploy until root cause is known**
  - Create a Notion task: "Investigate why [code change] broke [feature]"
  - Engineer fixes it properly
  - Test in staging again
  - Then re-deploy
  
- [ ] **Document the lesson**
  - Update TROUBLESHOOTING.md if this is a new failure mode
  - Update DECISIONS.md if the incident changes how we deploy
  - Post retro summary in project channel

---

**Last updated**: 2026-09-20
