# Anonymised learning aggregate (MPC-9892)

Open Tracker design section 4.5. The product keeps what it learns, never who it learned it from.

## What is stored

`public.learning_aggregate_daily(day, dimension, key, n)`: four columns, counters only.

| dimension | key | filled from |
| --- | --- | --- |
| `scan` | `web_scan_saved` | `web_scans` delete |
| `hexagon_result` | `<hexagon-id>:found` / `not_found` / `not_checked` | `web_scans.results` at delete |
| `funnel_step` | `scan_started`, `scan_finished`, `results_viewed`, `contact_step_opened`, `contact_given` | `web_scan_events` at delete |
| `bot_family` | `bot:<family>` / `ai:<family>` (closed list, else `other_agent`) | `edge_visits` bot/AI delete |
| `country_bucket` | `hk`, `uk`, `eu`, `north_america`, `other` | `edge_visits` person/unknown delete |
| `tile_event` | `<hexagon-id>:shown` / `yes_me` / `not_me` / `disputed` / `kept` | `POST /api/learning/event` |

`day` is the Hong Kong calendar day the record left the database. Not kept: scan id or number, email, hash, IP, user-agent string, person key, fingerprint hash, free text, anything finer than a day.

## How it is built so it never held an identity

* `BEFORE DELETE` triggers on `web_scans` and `edge_visits` read `OLD` inside the deletion transaction and call `mpt_learning_count` (the only writer: `INSERT ... ON CONFLICT (day, dimension, key) DO UPDATE SET n = n + p_n`). Every delete path is covered: the retention purge, deletion by scan number, DSAR erase, and the free-record purge MPC-9890 adds. MPC-9890 needs no call to a hook.
* `POST /api/learning/event` takes `event_type`, `hexagon_id`, `answer` only. A `person_key` from an older cached page is ignored and never stored. The browser (`src/lib/learning/events.ts`) no longer makes or keeps any id.
* Keys come from closed vocabularies; the table's CHECK constraints refuse free text, and unknown hexagon ids are filed as `unknown`.

## Publication

The weekly Notion page (`workers/mpt-metrics-collector/publishers/learning-loop.js`) reads `mpt_learning_aggregate_week(from, to)`. Any cell of 1 to 4 prints `<5`; a hexagon seen under 5 times is not listed; no total is printed beside a floored row.

## Proofs in CI

1. Schema test: `supabase/tests/mpc-9892-learning-aggregate.test.sql` (exact columns, only date/text/bigint, closed vocabularies, access).
2. Canary test (`supabase/tests/run.sh`): a scan seeded with a unique email, IP, scan number and user agent; the deletion job runs; a `pg_dump` of the whole database plus the job log is grepped for each canary: zero hits (and the seed is visible in the dump before the job, so the test cannot pass empty).
3. SQL lint: `scripts/ci/check-learning-aggregate-sql.mjs` rejects any INSERT that is not a counter increment through `mpt_learning_count`, any INSERT ... SELECT, and any extra column.
4. Weekly page: `workers/mpt-metrics-collector/learning-loop.test.mjs`.

## Known limits (follow-ups)

* `src/lib/learning/measure.ts` and the confidence proposals were designed over per-person events (first answer per person, 30 distinct responders). With no person key they have only counts; MPC-9891 should retire or re-base them. `mpt_hexagon_events` is no longer written; MPC-9891 migrates and drops it.
* The canary seeds the email inside the scan's stored results. When MPC-9890 starts deleting `scans` / `leads` / `users`, extend the canary to seed those rows too.
* A scan deleted before this migration is not counted (no backfill: the point is nothing is reconstructed).

Rollback: see the header of `supabase/migrations/20261108210000_mpc_9892_learning_aggregate.sql`.
