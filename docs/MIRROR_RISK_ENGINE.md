# Mirror & Risk Engine — MPC-7252 Integration Guide

## Overview

The Mirror & Risk Engine is a complete OSINT + risk scoring system for MyPrivacyTOOL. It analyzes user data points (email, phone, handle, domain) against public breach databases and returns:

1. **Exposure Score** (0–100) based on breach/paste count
2. **Risk Level** (low/medium/high/critical)
3. **Risk-aware messaging** with 29 localization keys
4. **Next steps** prioritized by urgency

## Architecture

```
User Input (email, phone, etc.)
    ↓
[Input Validation] — email format, phone E.164, handle length, domain DNS
    ↓
[OSINT Lookup] — Cache check → Have I Been Pwned API → parse results
    ↓
[Risk Scoring] — exposure_score = min(100, breaches×10 + pastes×5)
    ↓
[Response Template] — Risk summary + messaging + next steps + localization keys
    ↓
JSON Response (RiskSummaryResponse)
```

## Files

| File | Purpose |
|------|---------|
| `src/lib/osintLookup.ts` | HIBP API integration + caching |
| `src/lib/riskScoring.ts` | Deterministic risk formula + state transitions |
| `src/lib/riskResponseTemplate.ts` | Templated JSON responses + next steps |
| `src/lib/mirrorRiskOrchestrator.ts` | **Single entry point** for the full workflow |
| `src/lib/mirrorRiskApi.ts` | Fetch-API HTTP handler: `/api/v1/scan`, `/api/v1/scan/batch`, `/api/v1/health` |
| `src/lib/__tests__/mirrorRiskEngine.test.ts`, `mirrorRiskApi.test.ts` | Vitest suites (HIBP faked, no network) |

## Quick Start

### Single Lookup

```typescript
import { executeRiskAnalysis } from '@/lib/mirrorRiskOrchestrator';

const result = await executeRiskAnalysis({
  value: 'user@example.com',
  type: 'email',
});

if (result.success) {
  console.log(`Exposure Score: ${result.data.score}`);
  console.log(`Risk Level: ${result.data.level}`);
  console.log(`Next Steps:`, result.data.next_steps);
} else {
  console.error(`Error: ${result.error.code} — ${result.error.message}`);
}
```

### Batch Processing

```typescript
import { executeBatchRiskAnalysis } from '@/lib/mirrorRiskOrchestrator';

const results = await executeBatchRiskAnalysis({
  values: [
    { value: 'alice@example.com', type: 'email' },
    { value: 'bob@example.com', type: 'email' },
    { value: '+1-555-0123', type: 'phone' },
  ],
  parallel: true,
});

console.log(`Processed: ${results.metadata.successCount}/${results.metadata.batchSize}`);
results.results.forEach((r) => {
  if (r.success) {
    console.log(`Score: ${r.data.score} (${r.data.level})`);
  }
});
```

### Stream Processing (Workers)

```typescript
import { executeStreamRiskAnalysis } from '@/lib/mirrorRiskOrchestrator';

async function* getInputs() {
  // Yield from DB, file, queue, etc.
  yield { value: 'user1@example.com', type: 'email' };
  yield { value: 'user2@example.com', type: 'email' };
  // ... more
}

for await (const result of executeStreamRiskAnalysis({
  source: getInputs(),
  batchSize: 50,
  onResult: async (result) => {
    // Save to DB, update UI, etc.
    if (result.success) {
      await saveScore(result.data);
    }
  },
})) {
  // Handle results as they arrive
}
```

## API Endpoints

Implemented by `handleRiskRequest(request, env)` in `src/lib/mirrorRiskApi.ts`. It enforces the origin allowlist, an 8 KB body limit, an optional `RATE_LIMITER` binding, and a batch cap of 10. **It is not yet mounted in any deployed Worker**; mounting it (and the `HIBP_API_KEY` secret) is a deploy decision.

### POST /api/v1/scan

**Request:**
```json
{
  "value": "user@example.com",
  "type": "email"
}
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "score": 45,
    "level": "medium",
    "confidence": "high",
    "summary": "Your email appears in 4 breaches.",
    "explanation": "...",
    "next_steps": [
      {
        "priority": "high",
        "action": "Change passwords",
        "reason": "...",
        "localization_key": "risk.change_passwords"
      }
    ],
    "exposure_types": ["Email addresses", "Passwords"],
    "exposure_count": {
      "breaches": 4,
      "pastes": 1,
      "total": 5
    },
    "temporal_info": {
      "risk": "recent",
      "last_checked": "2026-10-09T04:41:24Z"
    },
    "localization_keys": [
      "risk.check_exposure",
      "risk.change_passwords",
      "risk.enable_2fa",
      ...
    ],
    "state_transition": {
      "currentState": "at_risk",
      "previousState": "protected",
      "shouldEscalate": true,
      "messageTone": "urgent"
    }
  },
  "metadata": {
    "processingTime": 342,
    "timestamp": "2026-10-09T04:41:24.495Z",
    "cached": false,
    "apiVersion": "1.0.0"
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_EMAIL",
    "message": "Invalid email format",
    "details": "..."
  },
  "metadata": {
    "processingTime": 45,
    "timestamp": "2026-10-09T04:41:24.495Z",
    "cached": false,
    "apiVersion": "1.0.0"
  }
}
```

### POST /api/v1/scan/batch

**Request:**
```json
{
  "values": [
    { "value": "user@example.com", "type": "email" },
    { "value": "+1-555-0123", "type": "phone" }
  ],
  "parallel": true
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    { /* single scan response 1 */ },
    { /* single scan response 2 */ }
  ],
  "metadata": {
    "totalTime": 512,
    "batchSize": 2,
    "successCount": 2,
    "failureCount": 0
  }
}
```

### GET /api/v1/health

**Response:**
```json
{
  "status": "healthy",
  "osintApi": "ok",
  "timestamp": "2026-10-09T04:41:24Z"
}
```

## Risk Scoring Formula

### Deterministic Score Calculation

```
exposure_score = min(100, (breach_count × 10) + (paste_count × 5))
```

**Examples:**
- 0 breaches, 0 pastes = 0 (Low)
- 1 breach, 0 pastes = 10 (Low)
- 3 breaches, 2 pastes = 40 (Medium)
- 6 breaches, 3 pastes = 75 (High)
- 8 breaches, 4 pastes = 100 (Critical, capped)

### Risk Bands

| Score | Level | Action |
|-------|-------|--------|
| 0 | Low | Monitor |
| 1–29 | Medium | Review |
| 30–59 | High | Act |
| 60–100 | Critical | Urgent |

### What is never scored

Only **email** can be answered (HIBP). `phone`, `handle` and `domain`, and any email lookup that could not run (no API key, timeout, HTTP 429/401/5xx), return `status: "not_checked"` with `score: null` and `level: "not_checked"`. A failed or unsupported check is never presented as low risk or reassuring. `reason` is one of `unsupported_type | no_api_key | rate_limited | timeout | upstream_error`.

## Localization Keys (29 total)

The response includes an array of 29 localization keys for i18n:

```typescript
[
  'risk.check_exposure',
  'risk.change_passwords',
  'risk.enable_2fa',
  'risk.freeze_credit',
  'risk.review_breaches',
  'risk.monitor_accounts',
  'risk.protect_yourself',
  'risk.update_passwords',
  'risk.set_fraud_alerts',
  'risk.contact_banks',
  // ... 19 more keys for multi-language support
]
```

## State Transitions

The engine tracks user awareness state:

| From | To | Trigger | Message Tone |
|------|----|---------|----|
| `new` | `aware` | First scan | Neutral |
| `aware` | `at_risk` | High/critical score | Urgent |
| `at_risk` | `protected` | Score drops | Reassuring |
| `at_risk` | `recovering` | Actions taken | Encouraging |

## Error Codes

| Code | Meaning | Action |
|------|---------|--------|
| `INVALID_EMAIL` | Email format validation failed | Check email syntax |
| `INVALID_PHONE` | Phone format validation failed | Check E.164 format |
| `INVALID_HANDLE` | Handle format validation failed | 3–50 alphanumeric chars |
| `INVALID_DOMAIN` | Domain validation failed | Check DNS format |
| `UNKNOWN_ERROR` | Unexpected failure (message is generic, no PII) | Retry |

Upstream HIBP problems are **not** errors: they return success with `status: "not_checked"`.

## Caching Strategy

- **Cache hit:** ~50ms (return cached result)
- **Cache miss:** ~2–5s (API call + parse + cache write)
- **TTL:** 24 hours (configurable)
- **Keys:** SHA-256 of `type:value`; the raw value is never stored. Failures are not cached.
- **Scope:** in-memory per Worker isolate (best effort). A shared store (KV/Supabase) is future work.

## Integration Checklist

- [ ] Install dependencies: `npm install`
- [ ] Set `HIBP_API_KEY` as a Worker secret (`wrangler secret put HIBP_API_KEY`); it is passed in as `env.HIBP_API_KEY`, never read from `process.env` or a client bundle
- [ ] Run tests: `npm test -- mirrorRiskEngine.test`
- [ ] Add health check to monitoring (GET /api/v1/health)
- [ ] Configure rate limiting (per IP, per user)
- [ ] Set cache TTL in Redis config
- [ ] Add API documentation to OpenAPI/Swagger
- [ ] Set up error alerting for API failures
- [ ] Load-test with batch/stream endpoints
- [ ] Deploy to staging → production

## Performance

| Scenario | Time | Notes |
|----------|------|-------|
| Single lookup (cache hit) | ~50ms | Fastest path |
| Single lookup (cache miss) | 2–5s | HIBP API latency |
| Batch of 50 (parallel) | 2–6s | Depends on cache hits |
| Batch of 50 (sequential) | 100–250s | Avoid this |
| Stream (1000 items, batch=10) | 20–60s | Continuous processing |

## Testing

**Run all tests:**
```bash
npm test -- mirrorRiskEngine.test
```

**Run specific suite:**
```bash
npm test -- mirrorRiskEngine.test -t "Risk Scoring"
```

**Coverage:**
```bash
npm test -- --coverage src/lib/mirrorRiskOrchestrator.ts
```

Expected coverage:
- Statements: >90%
- Branches: >85%
- Functions: >90%
- Lines: >90%

## Troubleshooting

### Slow lookups
- Check HIBP API rate limits (3 req/sec)
- Verify cache is hit (check `result.metadata.cached`)
- Consider pre-warming cache for common values

### High error rate
- Verify `HIBP_API_KEY` is set and valid
- Check network connectivity to haveibeenpwned.com
- Review error codes (see "Error Codes" table)

### Memory usage
- Stream processing uses constant memory (async generator)
- Batch processing holds results in memory (watch batch size)
- Cache can grow large (configure TTL/eviction)

## Next Steps

1. **API Endpoints:** Create Next.js API routes using orchestrator
2. **Frontend:** Implement exposure scan UI component
3. **Database:** Store scan history (audit trail + analytics)
4. **Webhooks:** Support async scan notifications
5. **Cleanup:** Email removal integration

---

**Status:** Draft. Not run against live HIBP (needs a key-holder run with 3 real data points). Not mounted in a Worker yet.
**Version:** 1.0.0
**Last Updated:** 2026-10-10
**Branch:** feat/mpc-7252-mirror-risk-engine
