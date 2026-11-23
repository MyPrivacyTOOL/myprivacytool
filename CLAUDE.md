# CLAUDE.md: MyPrivacyTOOL

- **Merge your own PR when green (standing rule, Chris 2026-10-10 and 2026-11-18, CK-10815)**: once the
  required `CI gate` check is green, merge your own PR without asking (turn on auto-merge so GitHub waits, then
  end the session). Never while a check is red or pending; never another session's PR; never a PR on
  `docs/HELD_PRS.md`. After merging, confirm the deploy and say so. "Do not merge" in a prompt only counts if
  the task is on that held list. Force-push stays always-ask.
- **Red check on your own PR (MPC-10621, 2026-11-23)**: the rule above stands. If a required check is red for a reason
  your diff cannot cause (for example a calendar expiry), do not merge on your own. Say which check, the log line, and why
  it is unrelated, comment once on the PR, then wait for the owner's explicit "merge" in the same session. When the owner
  says merge, merge and record the red check in the task notes. Fixing the cause is a separate PR.
