# Hexagon Risk Registry -> Workers KV (MPC-8369)

Notion's **Hexagon Risk Registry** (130 agent risks, 5 pillars) is the source of truth. Workers KV namespace
`MPT_AGENT_RISK_REGISTRY` (id `dea24686a03f47b899436b717301c729`) is a read-only cache for sub-5ms reads at the edge.

Keys: `risk:<id>` (1 to 130) and `index` (`synced_at`, `count`, `reviewed_count`, list). Values are the raw Notion
Likelihood, Impact and Exploitability (the Notion `Weight` formula is not readable through the API; compute weights in the consumer).
Rows with `review_status: "Draft"` carry unreviewed default scores.

## Run it locally (checks the script end to end)

Needs Node 18 or newer and these environment variables (names only, never commit values):

| Variable | What |
|---|---|
| `NOTION_TOKEN` | Notion internal integration token, with the **Hexagon Risk Registry** database shared to that integration |
| `CLOUDFLARE_API_TOKEN` | API token with **Account > Workers KV Storage > Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | `35cb17172c65a20f5cf1baf131485382` |
| `KV_NAMESPACE_ID` | optional, defaults to the namespace above |

```bash
# 1. dry run: reads Notion only, prints the count, writes nothing (needs only NOTION_TOKEN)
NOTION_TOKEN=... node scripts/sync-risk-registry-to-kv.mjs --dry-run
# expect: "130 risks (130 reviewed) -> 131 KV keys in dea24686a03f47b899436b717301c729" and "dry run: nothing written"

# 2. real run
NOTION_TOKEN=... CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=35cb17172c65a20f5cf1baf131485382 \
  node scripts/sync-risk-registry-to-kv.mjs
# expect: "KV sync complete"
```

Verify: the `index` key shows `count: 130`; `risk:1` is "Direct prompt injection" (4/4/4); `risk:130` is "Compliance certification gap" (3/3/3).
The script refuses to write if Notion returns no rows or duplicate Risk IDs.

## Keeping it fresh (proposal, not enabled)

A free-tier GitHub Action: weekly, plus on demand, plus `repository_dispatch` if a Notion automation should push on edit.
Needs repo secrets `NOTION_TOKEN` and a Cloudflare token with Workers KV Storage Edit (the existing deploy token has Workers
Scripts and zone permissions only, so make a separate, KV-only token).

```yaml
name: Sync risk registry to KV
on:
  schedule: [{ cron: '17 3 * * 1' }]      # Mondays 03:17 UTC
  workflow_dispatch:
  repository_dispatch: { types: [risk-registry-updated] }
permissions: { contents: read }
concurrency: { group: risk-registry-kv-sync, cancel-in-progress: false }
jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: node scripts/sync-risk-registry-to-kv.mjs
        env:
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN_RISK_REGISTRY }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_KV_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

Run it once by hand (`workflow_dispatch`) before relying on the schedule. A Notion automation can POST to
`https://api.github.com/repos/MyPrivacyTOOL/myprivacytool/dispatches` with `{"event_type":"risk-registry-updated"}` and a
fine-grained token limited to this repo (Contents: read, Actions: write) to trigger it on edit.
