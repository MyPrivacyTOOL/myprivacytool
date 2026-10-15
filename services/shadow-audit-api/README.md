# Agent Shadow Audit API v1 MVP

**Status:** Development (Ready for testing)  
**Service:** `shadow-audit-api-v1`  
**Language:** Python 3.11+  
**Framework:** FastAPI  
**Architecture:** Microservice

---

## Overview

The Agent Shadow Audit API provides **non-invasive auditing** of agent behavior against the **130-risk Hexagon Framework**, assigning risk scores across five pillars of privacy and compliance.

### Key Features

- **Hexagon Framework** — 130 categorized risks across 5 pillars
- **W3C Verifiable Credentials** — issue agent passports as compliant credentials
- **Risk Scoring** — probabilistic scoring engine with pillar-based breakdown
- **Audit Orchestration** — full or scoped audits on agent context
- **Passport Management** — issue, validate, and revoke credentials
- **Compliance Reporting** — export audit results with metadata

---

## Architecture

```
shadow-audit-api/
├── app/
│   ├── main.py                 # FastAPI app, routes, health check
│   ├── models.py               # Pydantic data models
│   ├── services/
│   │   ├── risk_scoring.py     # RiskScoring engine (130 risks)
│   │   ├── passport_service.py # W3C VC credential management
│   │   └── audit_service.py    # Audit orchestration
│   └── hexagon/
│       └── framework.py        # 130-risk Hexagon Framework
├── tests/
│   ├── test_risk_scoring.py    # Unit tests for RiskScoring
│   ├── test_passport_service.py # Unit tests for PassportCredentialService
│   └── test_passport_endpoints.py # Integration tests for API endpoints
├── requirements.txt            # Python dependencies
├── pytest.ini                  # Pytest configuration
├── API_DOCUMENTATION.md        # Complete API reference
└── README.md                   # This file
```

---

## Installation

### Prerequisites

- Python 3.11 or higher
- pip or poetry

### Setup

```bash
# Clone the repo
git clone https://github.com/MyPrivacyTOOL/myprivacytool.git
cd myprivacytool/services/shadow-audit-api

# Install dependencies
pip install -r requirements.txt

# Run the service
uvicorn app.main:app --host 0.0.0.0 --port 8000

# Service available at http://localhost:8000
```

---

## Quick Start

### 1. Health Check

```bash
curl http://localhost:8000/health
```

Response:
```json
{
  "status": "healthy",
  "service": "shadow-audit-api-v1",
  "timestamp": "2026-10-15T16:20:31.282Z"
}
```

### 2. List Hexagon Risks

```bash
curl http://localhost:8000/api/v1/hexagon/risks
```

Returns all 130 risks with pillar, severity, description, and recommendations.

### 3. Run an Audit

```bash
curl -X POST http://localhost:8000/api/v1/audit/run \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent-001",
    "context": {
      "shell": true,
      "filesystem": true,
      "browser": true,
      "secrets_exposed": [],
      "task_count": 42,
      "task_failures": 2
    },
    "issue_passport": true
  }'
```

Returns audit result with risk scores and issued passport (if criteria met).

### 4. Validate a Passport

```bash
curl -X POST http://localhost:8000/api/v1/passport/validate \
  -H "Content-Type: application/json" \
  -d '{
    "passport_id": "passport-1a2b3c4d5e6f",
    "verify_signature": true
  }'
```

Returns validation result (valid/invalid with errors).

---

## Testing

### Run All Tests

```bash
pytest
```

### Run Specific Test Suite

```bash
# Unit tests only
pytest tests/test_risk_scoring.py -v

# Passport tests only
pytest tests/test_passport_service.py -v

# API integration tests only
pytest tests/test_passport_endpoints.py -v
```

### Run Tests with Coverage

```bash
pytest --cov=app --cov-report=html
# Open htmlcov/index.html in browser
```

### Run Tests by Marker

```bash
pytest -m unit      # Only unit tests
pytest -m integration # Only integration tests
pytest -m passport  # Only passport tests
pytest -m audit     # Only audit tests
```

---

## API Endpoints

### Health & Status

- `GET /health` — Service health check

### Hexagon Framework

- `GET /api/v1/hexagon/risks` — List all 130 risks

### Audit Endpoints

- `POST /api/v1/audit/run` — Execute a full or scoped audit
- `GET /api/v1/audit/{audit_id}` — Retrieve audit result

### Passport Endpoints (W3C Verifiable Credentials)

- `POST /api/v1/passport/issue` — Issue a passport credential
- `GET /api/v1/passport/{passport_id}` — Retrieve passport
- `POST /api/v1/passport/validate` — Validate passport signature/status
- `POST /api/v1/passport/revoke` — Revoke passport credential
- `GET /api/v1/passport/agent/{agent_id}` — List agent passports

For complete API reference, see [API_DOCUMENTATION.md](./API_DOCUMENTATION.md).

---

## Core Services

### RiskScoring Engine

**File:** `app/services/risk_scoring.py`

Implements probabilistic scoring across all 130 Hexagon Framework risks.

**Key Methods:**
- `score_agent(context)` — Run full audit with all 130 risks
- `score_pillar(pillar, context)` — Score a single pillar (1 of 5)
- `compute_overall_score(pillar_scores)` — Aggregate pillar scores to overall (0-100)

**Scoring Formula:**
```
overall_score = weighted_average(
    data_exposure: 0.25,
    consent_validity: 0.20,
    credential_security: 0.25,
    process_integrity: 0.20,
    external_risk: 0.10
)
```

### PassportCredentialService

**File:** `app/services/passport_service.py`

Manages W3C Verifiable Credentials as agent passports.

**Key Methods:**
- `issue_passport(audit_result, agent_id, agent_name)` — Create new passport
- `validate_passport(passport_id, verify_signature)` — Verify status/signature
- `revoke_passport(passport_id, reason)` — Mark revoked
- `get_passport(passport_id)` — Retrieve by ID
- `list_agent_passports(agent_id)` — All passports for agent

**Issuance Criteria:**
- ✓ Overall risk score ≥ 70
- ✓ No CRITICAL risks detected
- ✓ High-risk count ≤ 2

### AuditService

**File:** `app/services/audit_service.py`

Orchestrates audit lifecycle.

**Key Methods:**
- `run_audit(agent_id, context, pillar, issue_passport)` — Execute audit
- `get_audit(audit_id)` — Retrieve result
- `export_audit(audit_id, format)` — Export as JSON/CSV/PDF

---

## Hexagon Framework

The **130-risk Hexagon Framework** categorizes privacy and compliance risks into five pillars:

### 1. Data Exposure (DR) — 26 Risks

Focus: Data broker presence, APAC coverage, removal success.

**Example Risks:**
- `DR-001`: Data Broker Presence - US
- `DR-025`: APAC Data Broker Coverage Gap
- `DR-050`: Removal Success Rate < 80%

### 2. Consent Validity (CV) — 26 Risks

Focus: Consent capture, storage, revocation capability.

**Example Risks:**
- `CV-001`: No Consent Log
- `CV-015`: Consent Expiration Not Tracked
- `CV-030`: No Revocation Capability

### 3. Credential Security (CS) — 26 Risks

Focus: Secrets, tokens, exposure handling.

**Example Risks:**
- `CS-001`: Secret Exposure in Logs
- `CS-015`: GitHub Token Not Rotated in > 90 Days
- `CS-030`: API Keys Hardcoded in Repo

### 4. Process Integrity (PI) — 26 Risks

Focus: Logging, error handling, compliance guardrails.

**Example Risks:**
- `PI-001`: Audit Trail Incomplete
- `PI-015`: Task Failure Rate > 10%
- `PI-030`: No Approval Mechanism

### 5. External Risk (ER) — 26 Risks

Focus: Third-party APIs, supply chain, regulatory exposure.

**Example Risks:**
- `ER-001`: Unvetted Dependency
- `ER-015`: GDPR Exposure (EU personal data)
- `ER-030`: Regulatory Non-Compliance (CCPA, PDPO)

---

## W3C Verifiable Credential Format

Agent passports are issued as W3C Verifiable Credentials (VC 1.1).

**Example Credential:**
```json
{
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
    "compliance_level": "partial_compliant"
  },
  "proof": {
    "type": "Ed25519Signature2020",
    "created": "2026-10-15T16:20:31Z",
    "verificationMethod": "https://myprivacytool.io/shadow-audit-api/keys/issuer-1",
    "signatureValue": "z3t4aB9cD2eF1gH5iJ8kL7mN6oP3qR0sT9uV2wX5yZ8aA3bB6cC9dD2eE5fF8gG1hH4iI7jJ0kK3lL6mM9nN2oO5pP8qQ1rR4sS7tT0uU3vV6wW9xX2yY5zZ8"
  }
}
```

---

## Development

### Adding a New Risk

1. Open `app/hexagon/framework.py`
2. Add risk dict to appropriate pillar (DR, CV, CS, PI, ER)
3. Update scoring logic in `app/services/risk_scoring.py`
4. Add unit test to `tests/test_risk_scoring.py`
5. Run tests: `pytest`

### Adding a New Endpoint

1. Open `app/main.py`
2. Add route with proper request/response models
3. Implement business logic in corresponding service
4. Add integration test to `tests/test_passport_endpoints.py`
5. Document in `API_DOCUMENTATION.md`
6. Run tests: `pytest`

---

## Configuration

### Environment Variables

Create a `.env` file:

```
SERVICE_NAME=shadow-audit-api-v1
DEBUG=false
LOG_LEVEL=info
PASSPORT_EXPIRY_DAYS=90
SIGNATURE_ALGORITHM=ed25519
```

---

## Deployment

### Docker

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app/ app/
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Docker Compose

```yaml
version: '3.8'
services:
  shadow-audit-api:
    build: ./services/shadow-audit-api
    ports:
      - "8000:8000"
    environment:
      DEBUG: "false"
      LOG_LEVEL: "info"
```

### Cloud Run

```bash
gcloud run deploy shadow-audit-api-v1 \
  --source ./services/shadow-audit-api \
  --platform managed \
  --region us-central1 \
  --memory 2Gi \
  --cpu 2
```

---

## License

MIT License — See LICENSE file in root.

---

## Support

For issues, questions, or contributions:
- File a task with prefix `MPC` in Notion
- Contact: ops@myprivacytool.io

---

## Roadmap

### v1.0 (Current)
- ✓ Hexagon Framework (130 risks)
- ✓ RiskScoring engine
- ✓ W3C VC passports
- ✓ Audit orchestration
- ✓ 5-pillar architecture

### v1.1 (Planned)
- [ ] Database persistence (PostgreSQL)
- [ ] Audit history and trending
- [ ] Pillar-level dashboard
- [ ] Risk trend analysis
- [ ] Integration with OpenClaw26 fleet

### v2.0 (Future)
- [ ] Machine learning risk prediction
- [ ] Automated remediation recommendations
- [ ] Third-party API audit integrations
- [ ] Compliance mapping (GDPR/CCPA/PDPO)
- [ ] Public API (OAuth2 + rate limiting)
