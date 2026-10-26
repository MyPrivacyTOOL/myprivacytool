# Hexagon registry (MPC-7466)

One list of the 54 web scan hexagons (41 always, 13 conditional): label, group, what it captures, value to the user,
truth level (measured / estimate / cannot be checked), confidence the code holds, and the FOUND / CHECKED AND CLEAR /
NOT CHECKED rule. `trust_score` is deliberately null: Chris has not defined it. Do not fill it in.

- Code copy: `registry.js` (plain ESM, imported by the website in `src/` and by `workers/scan-report`).
- **Reviewed record (source of truth for the content): https://app.notion.com/p/3f628547eaa7810fac20ce7fd5efdc36**
  If the two disagree, stop and ask; change both in the same task and say so in the Result Summary.
- Tests: `src/lib/hexagonRegistry.test.ts` (vitest, ids and labels match the detection code) and `registry.test.mjs` (node, runs where the Worker runs).
- Hexagon artwork: none exists. Each hexagon is an inline SVG with one emoji (`artwork.emoji`).
- 46 was a hard-coded display number, 52 is the grid capacity, 28 was never found in the code.
- `status.js` (MPC-7487): `captureStatus(id, value, ctx)` decides FOUND / CHECKED AND CLEAR / NOT CHECKED when the site captures a value; `src/lib/webScan.ts` saves it with the scan. It follows the `status` rules here; change a rule in the registry, this file and the Notion page together.
- `EMAIL_HEXAGONS`: the four email hexagons (MPC-7467), outside the 54 web hexagons. `workers/scan-report/scripts/sync-hexagons.mjs` builds the Worker's compact copy from this file.
- `score.js` (MPC-7471-F4): the one exposure score, bands and coverage, version `exposure-v1`. Reads category, severity (from `truth.sensitivity`) and the allowed statuses from this registry. Spec and open decisions: `docs/exposure-score-spec.md`. Tests: `score.test.mjs`. Change a weight, band or mapping there, in the spec and in the public explanation together.
