# Autonomous content pipeline (Plays 1–3)

```
GitHub Action 05:00 HKT  -> scripts/sync-content-cache-to-kv.mjs -> KV mpt-content-cache (schedule:<date>, brand:guidelines)
cron 06:00 HKT (22:00Z)  -> mpt-content-producer (reads today's topic from KV mpt-brand-topics) -> Queue mpt-content-generation-queue
                         -> mpt-content-consumer: tone guardrails from KV -> 6 concurrent Anthropic calls (X, LinkedIn, Instagram, Facebook, Pinterest, YouTube) -> D1 agent_execution_logs -> Slack #mpt-content-approval
Slack buttons / POST     -> mpt-content-approval /approve -> Make.com webhook + D1 (published, social_metrics) + Slack thread reply
```

Resources (account 35cb17172c65a20f5cf1baf131485382): KV `mpt-content-cache` 15f4c0ac614b4c60954dd42e9d8c8ee5, KV `mpt-brand-topics` 187c9af3fc3a44bea3b1eb80298ab0ce (key = HKT date),
D1 `mpt-agent-logs` b9dc1a03-74be-45a0-85db-fb61d80825ac (`migrations/0001_init.sql`, applied),
Queue `mpt-content-generation-queue` 6e4005efe6534b65b371c628898510e3.

Secrets (`wrangler secret put NAME` in the Worker's directory; names in each `EXPECTED_SECRETS.txt`):
consumer `ANTHROPIC_API_KEY`, `SLACK_BOT_TOKEN`; approval `APPROVAL_API_TOKEN` (any long random string), `MAKE_WEBHOOK_URL`, `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`.
Slack app: add the bot to #mpt-content-approval; set Interactivity Request URL to `https://mpt-content-approval.myprivacytool.workers.dev/approve`.

Make.com: the only live webhook (scenario MPC-6952) reads `title, excerpt, url, campaign, linkedin_text` and publishes LinkedIn only.
The approval Worker sends those plus the OpenClaw fields, one POST per platform. Metrics are written by the Make.com pipeline or a polling Worker (Analytics Engine rejected).

Tests: `npx vitest run workers/mpt-content-producer workers/mpt-content-consumer --coverage` (Anthropic, Slack, KV, D1 mocked; 90% threshold per Worker in vitest.config.ts). The older `node workers/mpt-content-consumer/worker.test.mjs` also covers the approval Worker.
