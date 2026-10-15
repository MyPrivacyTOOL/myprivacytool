# Agent Shadow Audit API v1 — Complete API Documentation

**Version:** 1.0.0  
**Service:** `shadow-audit-api-v1`  
**Base URL:** `https://myprivacytool.io/api/v1` (production)  
**Issuer:** `https://myprivacytool.io/shadow-audit-api`

---

## Overview

The Agent Shadow Audit API provides non-invasive auditing of agent behavior against the **130-risk Hexagon Framework**, assigning risk scores across five pillars:

1. **Data Exposure** — data broker presence, APAC coverage, removal options
2. **Consent Validity** — consent capture, storage, revocation capability
3. **Credential Security** — secret rotation, storage, exposure handling
4. **Process Integrity** — logging, error handling, task completion guardrails
5. **External Risk** — third-party API abuse, supply chain, regulatory exposure

### Core Deliverables

- **Audit Endpoint** — run full or scoped audits on agent context
- **W3C Verifiable Credentials** — issue, validate, and revoke agent passports
- **Hexagon Framework Queries** — list all 130 risks and their metadata
- **Compliance Reporting** — generate audit results with pillar breakdown

---

## Authentication

**Current Status:** No authentication (development/internal use).

**Production:** TBD — OAuth2 / API Key required.

---

## HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad request (missing/invalid params) |
| 404 | Resource not found |
| 422 | Unprocessable entity (JSON validation error) |
| 500 | Server error |

---

## Endpoints

### 1. Health Check

#### `GET /health`

Check service status.

**Response:**
```json
{
  "status": "healthy",
  "service": "shadow-audit-api-v1",
  "timestamp": "2026-10-15T16:20:31.282Z"
}
```

---

### 2. Hexagon Framework

#### `GET /api/v1/hexagon/risks`

List all 130 risks in the Hexagon Framework.

**Response:**
```json
{
  "risks": [
    {
      "risk_id": "DR-001",
      "risk_name": "Data Broker Presence - US",
      "pillar": "data_exposure",
      "severity": "high",
      "description": "Agent data presence on major US data brokers (Experian, Equifax, etc.)",
      "recommendation": "Initiate removal requests with each broker; verify completion"
    },
    // ... 129 more risks
  ],
  "total": 130
}
```

---

### 3. Audit Endpoints

#### `POST /api/v1/audit/run`

Run a full or scoped audit on agent context.

**Request Body:**
```json
{
  "agent_id": "agent-001",
  "context": {
    "logs": ["2026-10-15: Task MPC-123 completed", "..."],
    "environment": {
      "shell": true,
      "filesystem": true,
      "browser": true
    },
    "consent_log": [
      {
        "timestamp": "2026-10-01T10:00:00Z",
        "action": "request_human_approval",
        "status": "approved"
      }
    ],
    "secrets_rotated": ["GITHUB_TOKEN_MYPRIVACYTOOL", "CF_API_TOKEN"],
    "secrets_exposed": [],
    "task_count": 42,
    "task_failures": 2,
    "audit_trail_completeness": 0.98
  },
  "pillar": null,
  "issue_passport": true
}
```

**Response:**
```json
{
  "audit_id": "audit-a1b2c3d4e5f6",
  "agent_id": "agent-001",
  "overall_risk_score": 80,
  "total_risks_detected": 5,
  "critical_count": 0,
  "high_count": 1,
  "pillar_scores": {
    "data_exposure": 75,
    "consent_validity": 85,
    "credential_security": 80,
    "process_integrity": 85,
    "external_risk": 90
  },
  "detected_risks": [
    {
      "risk_id": "DR-025",
      "risk_name": "APAC Data Broker Coverage Gap",
      "pillar": "data_exposure",
      "severity": "high",
      "evidence": "Agent has no scans from Singapore, HK, or AU data brokers"
    }
  ],
  "passport": {
    "passport_id": "passport-1a2b3c4d",
    "agent_id": "agent-001",
    "audit_id": "audit-a1b2c3d4e5f6",
    "issued_at": "2026-10-15T16:20:31Z",
    "expires_at": "2027-01-13T16:20:31Z",
    "compliance_level": "partial_compliant"
  },
  "timestamp": "2026-10-15T16:20:31Z"
}
```

**Query Parameters:**
- `agent_id` (required): Agent identifier
- `pillar` (optional): Audit only one pillar (values: `data_exposure`, `consent_validity`, `credential_security`, `process_integrity`, `external_risk`)
- `issue_passport` (optional): Auto-issue passport if audit passes (default: `false`)

---

#### `GET /api/v1/audit/{audit_id}`

Retrieve a previously executed audit result.

**Response:** Same structure as `POST /api/v1/audit/run` response.

**Status Codes:**
- 200: Audit found
- 404: Audit not found

---

### 4. Passport Endpoints (W3C Verifiable Credentials)

#### `POST /api/v1/passport/issue`

Issue an Agent Passport credential based on an audit result.

**Query Parameters:**
- `audit_id` (required): The audit to base the passport on
- `agent_id` (required): Agent identifier
- `agent_name` (optional): Human-readable agent name

**Issuance Criteria** (ALL must be met):
- ✓ Overall risk score ≥ 70
- ✓ No CRITICAL risks detected
- ✓ High-risk count ≤ 2

**Response:**
```json
{
  "passport_id": "passport-1a2b3c4d5e6f",
  "agent_id": "agent-001",
  "audit_id": "audit-a1b2c3d4e5f6",
  "issued_at": "2026-10-15T16:20:31Z",
  "expires_at": "2027-01-13T16:20:31Z",
  "revoked": false,
  "revocation_reason": null,
  "compliance_level": "partial_compliant",
  "credential": {
    "@context": "https://www.w3.org/2018/credentials/v1",
    "type": ["VerifiableCredential", "AgentPassport"],
    "issuer": "https://myprivacytool.io/shadow-audit-api",
    "issuanceDate": "2026-10-15T16:20:31Z",
    "expirationDate": "2027-01-13T16:20:31Z",
    "credentialSubject": {
      "id": "did:agent:agent-001",
      "agent_id": "agent-001",
      "agent_name": "TestAgent",
      "overall_risk_score": 80,
      "compliance_level": "partial_compliant",
      "data_exposure_compliant": true,
      "consent_validity_compliant": true,
      "credential_security_compliant": true,
      "process_integrity_compliant": true,
      "external_risk_compliant": true
    },
    "proof": {
      "type": "Ed25519Signature2020",
      "created": "2026-10-15T16:20:31Z",
      "verificationMethod": "https://myprivacytool.io/shadow-audit-api/keys/issuer-1",
      "signatureValue": "z3t4aB9cD2eF1gH5iJ8kL7mN6oP3qR0sT9uV2wX5yZ8aA3bB6cC9dD2eE5fF8gG1hH4iI7jJ0kK3lL6mM9nN2oO5pP8qQ1rR4sS7tT0uU3vV6wW9xX2yY5zZ8"
    }
  }
}
```

**Status Codes:**
- 200: Passport issued
- 400: Audit does not meet issuance criteria
- 404: Audit not found

---

#### `GET /api/v1/passport/{passport_id}`

Retrieve a passport credential by ID.

**Response:** Same structure as `POST /api/v1/passport/issue` response.

**Status Codes:**
- 200: Passport found
- 404: Passport not found

---

#### `POST /api/v1/passport/validate`

Validate a passport credential.

**Request Body:**
```json
{
  "passport_id": "passport-1a2b3c4d5e6f",
  "verify_signature": true
}
```

**Response:**
```json
{
  "valid": true,
  "passport_id": "passport-1a2b3c4d5e6f",
  "agent_id": "agent-001",
  "compliance_level": "partial_compliant",
  "is_expired": false,
  "is_revoked": false,
  "errors": []
}
```

**Validation Checks:**
1. ✓ Passport exists
2. ✓ Not expired (current time < expirationDate)
3. ✓ Not revoked
4. ✓ Signature valid (if `verify_signature: true`)

**Status Codes:**
- 200: Validation result returned (check `valid` field)

---

#### `POST /api/v1/passport/revoke`

Revoke a passport credential.

**Query Parameters:**
- `passport_id` (required): Passport to revoke
- `reason` (required): Revocation reason

**Response:**
```json
{
  "revoked": true,
  "passport_id": "passport-1a2b3c4d5e6f",
  "reason": "Agent violated compliance policy",
  "timestamp": "2026-10-15T16:20:31Z"
}
```

**Status Codes:**
- 200: Revocation successful
- 404: Passport not found

---

#### `GET /api/v1/passport/agent/{agent_id}`

List all passports issued for an agent.

**Response:**
```json
{
  "agent_id": "agent-001",
  "passports": [
    {
      "passport_id": "passport-1a2b3c4d",
      "audit_id": "audit-a1b2c3d4e5f6",
      "issued_at": "2026-10-15T16:20:31Z",
      "expires_at": "2027-01-13T16:20:31Z",
      "compliance_level": "partial_compliant",
      "revoked": false
    }
  ],
  "total": 1
}
```

**Status Codes:**
- 200: List returned (empty if no passports)

---

## Data Models

### AuditResult

```json
{
  "audit_id": "audit-1a2b3c4d5e6f",
  "agent_id": "agent-001",
  "overall_risk_score": 80,
  "total_risks_detected": 5,
  "critical_count": 0,
  "high_count": 1,
  "pillar_scores": {
    "data_exposure": 75,
    "consent_validity": 85,
    "credential_security": 80,
    "process_integrity": 85,
    "external_risk": 90
  },
  "detected_risks": [
    {
      "risk_id": "DR-025",
      "risk_name": "APAC Data Broker Coverage Gap",
      "pillar": "data_exposure",
      "severity": "high",
      "evidence": "Agent has no scans from Singapore, HK, or AU data brokers"
    }
  ],
  "timestamp": "2026-10-15T16:20:31Z"
}
```

### AgentPassport

```json
{
  "passport_id": "passport-1a2b3c4d5e6f",
  "agent_id": "agent-001",
  "audit_id": "audit-a1b2c3d4e5f6",
  "issued_at": "2026-10-15T16:20:31Z",
  "expires_at": "2027-01-13T16:20:31Z",
  "revoked": false,
  "revocation_reason": null,
  "compliance_level": "partial_compliant"
}
```

### Compliance Levels

| Level | Criteria |
|-------|----------|
| `compliant` | Risk score ≥ 80, zero CRITICAL risks, ≤ 2 HIGH risks |
| `partial_compliant` | Risk score ≥ 70, zero CRITICAL risks, ≤ 2 HIGH risks |
| `non_compliant` | Risk score < 70 OR CRITICAL risks exist |

---

## Hexagon Framework Pillars

### 1. Data Exposure (DR)

Risks related to data broker presence and removal coverage.

**Examples:**
- `DR-001`: Data Broker Presence - US
- `DR-025`: APAC Data Broker Coverage Gap
- `DR-050`: Removal Success Rate < 80%

### 2. Consent Validity (CV)

Risks related to consent capture, storage, and revocation capability.

**Examples:**
- `CV-001`: No Consent Log
- `CV-015`: Consent Expiration Not Tracked
- `CV-030`: No Revocation Capability

### 3. Credential Security (CS)

Risks related to secrets, tokens, and credentials.

**Examples:**
- `CS-001`: Secret Exposure in Logs
- `CS-015`: GitHub Token Not Rotated in > 90 Days
- `CS-030`: API Keys Hardcoded in Repo

### 4. Process Integrity (PI)

Risks related to logging, error handling, and compliance guardrails.

**Examples:**
- `PI-001`: Audit Trail Incomplete
- `PI-015`: Task Failure Rate > 10%
- `PI-030`: No Approval Mechanism

### 5. External Risk (ER)

Risks related to third-party APIs, supply chain, and regulatory exposure.

**Examples:**
- `ER-001`: Unvetted Dependency
- `ER-015`: GDPR Exposure (EU personal data)
- `ER-030`: Regulatory Non-Compliance (CCPA, PDPO)

---

## Usage Examples

### Example 1: Run an Audit and Issue Passport

```bash
curl -X POST "https://myprivacytool.io/api/v1/audit/run" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent-001",
    "context": {
      "shell": true,
      "filesystem": true,
      "browser": true,
      "secrets_exposed": [],
      "task_count": 42
    },
    "issue_passport": true
  }'
```

### Example 2: Validate a Passport

```bash
curl -X POST "https://myprivacytool.io/api/v1/passport/validate" \
  -H "Content-Type: application/json" \
  -d '{
    "passport_id": "passport-1a2b3c4d5e6f",
    "verify_signature": true
  }'
```

### Example 3: Revoke a Passport

```bash
curl -X POST "https://myprivacytool.io/api/v1/passport/revoke?passport_id=passport-1a2b3c4d5e6f&reason=Compliance%20violation"
```

### Example 4: List All Hexagon Risks

```bash
curl -X GET "https://myprivacytool.io/api/v1/hexagon/risks"
```

---

## Error Handling

### Bad Request (400)

```json
{
  "detail": "Audit did not meet credential issuance criteria (risk score < 70 or contains CRITICAL risks)"
}
```

### Not Found (404)

```json
{
  "detail": "Audit audit-nonexistent not found"
}
```

### Validation Error (422)

```json
{
  "detail": [
    {
      "loc": ["body", "passport_id"],
      "msg": "field required",
      "type": "value_error.missing"
    }
  ]
}
```

---

## Rate Limiting

**Current Status:** No rate limiting (development).

**Production:** TBD — likely 1,000 requests/minute per API key.

---

## Changelog

### v1.0.0 (2026-10-15)

- ✓ Audit endpoints (run, retrieve)
- ✓ Passport endpoints (issue, validate, revoke)
- ✓ Hexagon Framework query
- ✓ W3C VC credential format
- ✓ 130-risk framework
- ✓ 5-pillar architecture
- ✓ Compliance level computation

---

## Support

For issues or questions, file a task with prefix `MPC` in the main Notion database or contact the MyPrivacyTOOL ops team.
