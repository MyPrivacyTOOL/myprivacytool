# RUNBOOKS — Step-by-Step Procedures

This directory contains copy-paste runbooks for common operational tasks. Each runbook is a numbered checklist that someone can follow without deep knowledge of the system.

## Available Runbooks

- **[critical-incident.md](./critical-incident.md)** — When the site is down or data is affected
- **[rollback.md](./rollback.md)** — How to roll back a bad deployment
- **[rotate-credentials.md](./rotate-credentials.md)** — Quarterly credential rotation
- **[on-call-handoff.md](./on-call-handoff.md)** — Handoff procedure for on-call rotation

## How to Use a Runbook

1. **Copy the checklist** for your situation
2. **Work through each step in order** — do not skip
3. **Check off each step** as you complete it
4. **Document any deviations** in the task comments
5. **When done**, record what you learned in DECISIONS.md or TROUBLESHOOTING.md

## Adding a New Runbook

1. Create a new file: `docs/RUNBOOKS/{name}.md`
2. Use the template below
3. Test it (run through it once end-to-end)
4. Merge via PR
5. Link it from this README

---

## Runbook Template

```
# {Runbook Title}

**Use when**: [situation that triggers this runbook]  
**Estimated time**: [XX minutes]  
**Owner**: [which agent/role runs this]  
**Escalation**: If step N fails, contact [X]

## Checklist

- [ ] **Step 1**: Description
  - Sub-step A
  - Sub-step B
  - If X, then do Y; if not, do Z

- [ ] **Step 2**: Next thing

[Continue...]

## Validation

After completing all steps:
- [ ] Confirm [success criteria]
- [ ] Monitor [metric] for [duration]
- [ ] Post summary in [Slack channel]

## Rollback

If anything fails:
1. [Undo step X]
2. Contact [team]
3. Document issue in [task]
```

---

**Last updated**: 2026-09-20
