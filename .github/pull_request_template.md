## What and why

<!-- One or two sentences. Link the task (CK-/MPC- number). -->

## Testing

<!-- What you ran (lint, typecheck, unit, e2e) and the result. -->

## Checklist

- [ ] Copy change: swarm run and real-people check recorded (link), or not a copy change.
- [ ] AI provider or model: any new or changed AI provider/model that receives personal data is listed in the DPA sub-processor list (`src/pages/DPA.tsx`) and Privacy Policy section 5 BEFORE it is enabled in production (see `docs/AI-PROVIDERS.md`), or this PR does not touch one.

## Rollback

<!-- Usually: revert this PR. -->
