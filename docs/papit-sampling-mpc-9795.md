# MPC-9795 (EXT-08): GitHub event window, pagination, derived attributes

STEP 0 on main 136b24b, 2026-11-18. Stacked on PR #829 (MPC-9794) because both edit developerDocs.ts and the schema doc.

| # | Item | At HEAD | After this PR |
|---|------|---------|---------------|
| 1 | Publish the real activity window (300 events / 90 days) | STILL OPEN: only in docs/papit/schema-v1.md:36; /developers said "last 90 days" with no cap | Published on /developers (sentence + "Activity window" row), schema-v1.md already had it |
| 2 | Pagination caps (repos 3, starred 2, events 3 pages of 100) and a truncated flag | STILL OPEN: caps in adapter.js:14 only; no flag | `data_coverage` added to the profile (additive, v1.0): `repos_sampled`, `starred_sampled`, `events_capped` (true when the last allowed page was still full; null on a profile with no flag), inside the receipt. Caps published in the "How much we read" row; a test ties the stated caps to `MAX_PAGES`. Connect GitHub shows a "Large account" note when sampled |
| 3 | COPY-017 'skills' | STILL OPEN | Field kept (renaming would bump the schema major). Schema comment, /developers "skills" row and the Connect GitHub label ("Main languages") say it is languages by repo count, not skill. public_projects_count is GitHub's total incl. forks, languages come from non-fork repos in the sample: stated |
| 4 | DEV-006 empty vs unavailable vs filtered vs failed interests | STILL OPEN: `interests: []` was ambiguous | `data_coverage.interests`: `no_stars` / `stars_without_topics` / `found`. A failed or unavailable GitHub call already returns an error (401 reauthorize, 5xx), never an empty list: stated. "Filtered" = topics dropped by the slug rule: not separately flagged (follow-up) |

Acceptance: (a) window in code vs copy TRUE after the PR; (b) pagination completeness PARTIAL (it is a sample, now disclosed; no extra pages are fetched); (c) derived attributes computed as described TRUE (papit.js: top 10 languages, top 15 topics, 90-day count, thresholds 5 and 50).

Tests: workers/github-channel/test (76 pass, 4 new), vitest 3208 pass.
