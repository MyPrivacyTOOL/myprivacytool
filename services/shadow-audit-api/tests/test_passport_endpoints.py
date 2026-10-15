"""
Integration tests for passport API endpoints.

Tests the full request→response cycle for:
- POST /api/v1/passport/issue
- GET /api/v1/passport/{passport_id}
- POST /api/v1/passport/validate
- POST /api/v1/passport/revoke
- GET /api/v1/passport/agent/{agent_id}
"""

import pytest
from fastapi.testclient import TestClient
from datetime import datetime
from app.main import app, audit_results_store, passport_service
from app.models import AuditResult, PillarScore


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


@pytest.fixture
def passing_audit(client):
    """Create a passing audit result and store it."""
    audit = AuditResult(
        audit_id="audit-ep-001",
        agent_id="agent-endpoint-001",
        overall_risk_score=80,
        total_risks_detected=5,
        critical_count=0,
        high_count=1,
        pillar_scores={
            "data_exposure": PillarScore(pillar="data_exposure", score=75),
            "consent_validity": PillarScore(pillar="consent_validity", score=85),
            "credential_security": PillarScore(pillar="credential_security", score=80),
            "process_integrity": PillarScore(pillar="process_integrity", score=85),
            "external_risk": PillarScore(pillar="external_risk", score=90),
        },
        detected_risks=[],
        timestamp=datetime.utcnow(),
    )
    audit_results_store[audit.audit_id] = audit
    return audit


@pytest.fixture
def failing_audit(client):
    """Create a failing audit result and store it."""
    audit = AuditResult(
        audit_id="audit-ep-fail-001",
        agent_id="agent-endpoint-002",
        overall_risk_score=60,
        total_risks_detected=15,
        critical_count=2,
        high_count=5,
        pillar_scores={},
        detected_risks=[],
        timestamp=datetime.utcnow(),
    )
    audit_results_store[audit.audit_id] = audit
    return audit


# ============================================================================
# ISSUE PASSPORT ENDPOINT TESTS
# ============================================================================

def test_issue_passport_endpoint_success(client, passing_audit):
    """Test POST /api/v1/passport/issue with passing audit."""
    response = client.post(
        "/api/v1/passport/issue",
        params={
            "audit_id": "audit-ep-001",
            "agent_id": "agent-endpoint-001",
            "agent_name": "TestAgent",
        },
    )

    assert response.status_code == 200
    passport = response.json()
    assert passport["passport_id"].startswith("passport-")
    assert passport["agent_id"] == "agent-endpoint-001"
    assert passport["audit_id"] == "audit-ep-001"
    assert passport["revoked"] is False


def test_issue_passport_endpoint_audit_not_found(client):
    """Test POST /api/v1/passport/issue with non-existent audit."""
    response = client.post(
        "/api/v1/passport/issue",
        params={
            "audit_id": "audit-nonexistent",
            "agent_id": "agent-test",
        },
    )

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_issue_passport_endpoint_fails_criteria(client, failing_audit):
    """Test POST /api/v1/passport/issue when audit fails criteria."""
    response = client.post(
        "/api/v1/passport/issue",
        params={
            "audit_id": "audit-ep-fail-001",
            "agent_id": "agent-endpoint-002",
        },
    )

    assert response.status_code == 400
    assert "did not meet" in response.json()["detail"].lower()


# ============================================================================
# GET PASSPORT ENDPOINT TESTS
# ============================================================================

def test_get_passport_endpoint_success(client, passing_audit):
    """Test GET /api/v1/passport/{passport_id} for existing passport."""
    # First, issue a passport
    issue_response = client.post(
        "/api/v1/passport/issue",
        params={
            "audit_id": "audit-ep-001",
            "agent_id": "agent-endpoint-001",
        },
    )
    passport_id = issue_response.json()["passport_id"]

    # Then retrieve it
    response = client.get(f"/api/v1/passport/{passport_id}")

    assert response.status_code == 200
    passport = response.json()
    assert passport["passport_id"] == passport_id


def test_get_passport_endpoint_not_found(client):
    """Test GET /api/v1/passport/{passport_id} for non-existent passport."""
    response = client.get("/api/v1/passport/passport-nonexistent")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


# ============================================================================
# VALIDATE PASSPORT ENDPOINT TESTS
# ============================================================================

def test_validate_passport_endpoint_valid(client, passing_audit):
    """Test POST /api/v1/passport/validate for valid passport."""
    # Issue a passport
    issue_response = client.post(
        "/api/v1/passport/issue",
        params={
            "audit_id": "audit-ep-001",
            "agent_id": "agent-endpoint-001",
        },
    )
    passport_id = issue_response.json()["passport_id"]

    # Validate it
    response = client.post(
        "/api/v1/passport/validate",
        json={
            "passport_id": passport_id,
            "verify_signature": False,
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert result["valid"] is True
    assert result["agent_id"] == "agent-endpoint-001"
    assert len(result["errors"]) == 0


def test_validate_passport_endpoint_not_found(client):
    """Test POST /api/v1/passport/validate for non-existent passport."""
    response = client.post(
        "/api/v1/passport/validate",
        json={
            "passport_id": "passport-nonexistent",
            "verify_signature": False,
        },
    )

    assert response.status_code == 200  # Validation returns 200 with valid=False
    result = response.json()
    assert result["valid"] is False
    assert len(result["errors"]) > 0


# ============================================================================
# REVOKE PASSPORT ENDPOINT TESTS
# ============================================================================

def test_revoke_passport_endpoint_success(client, passing_audit):
    """Test POST /api/v1/passport/revoke for existing passport."""
    # Issue a passport
    issue_response = client.post(
        "/api/v1/passport/issue",
        params={
            "audit_id": "audit-ep-001",
            "agent_id": "agent-endpoint-001",
        },
    )
    passport_id = issue_response.json()["passport_id"]

    # Revoke it
    response = client.post(
        "/api/v1/passport/revoke",
        params={
            "passport_id": passport_id,
            "reason": "Compliance violation",
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert result["revoked"] is True
    assert result["passport_id"] == passport_id
    assert result["reason"] == "Compliance violation"


def test_revoke_passport_endpoint_not_found(client):
    """Test POST /api/v1/passport/revoke for non-existent passport."""
    response = client.post(
        "/api/v1/passport/revoke",
        params={
            "passport_id": "passport-nonexistent",
            "reason": "Test",
        },
    )

    assert response.status_code == 404


def test_revoke_passport_then_validate_fails(client, passing_audit):
    """Test that validation fails after revocation."""
    # Issue a passport
    issue_response = client.post(
        "/api/v1/passport/issue",
        params={
            "audit_id": "audit-ep-001",
            "agent_id": "agent-endpoint-001",
        },
    )
    passport_id = issue_response.json()["passport_id"]

    # Revoke it
    client.post(
        "/api/v1/passport/revoke",
        params={
            "passport_id": passport_id,
            "reason": "Test revocation",
        },
    )

    # Validate should now fail
    response = client.post(
        "/api/v1/passport/validate",
        json={
            "passport_id": passport_id,
            "verify_signature": False,
        },
    )

    result = response.json()
    assert result["valid"] is False
    assert any("revoked" in err.lower() for err in result["errors"])


# ============================================================================
# LIST AGENT PASSPORTS ENDPOINT TESTS
# ============================================================================

def test_list_agent_passports_endpoint_empty(client):
    """Test GET /api/v1/passport/agent/{agent_id} with no passports."""
    response = client.get("/api/v1/passport/agent/agent-nonexistent")

    assert response.status_code == 200
    result = response.json()
    assert result["agent_id"] == "agent-nonexistent"
    assert result["total"] == 0
    assert len(result["passports"]) == 0


def test_list_agent_passports_endpoint_multiple(client, passing_audit):
    """Test GET /api/v1/passport/agent/{agent_id} with multiple passports."""
    # Issue first passport
    client.post(
        "/api/v1/passport/issue",
        params={
            "audit_id": "audit-ep-001",
            "agent_id": "agent-endpoint-001",
        },
    )

    # Issue second passport (same agent, different audit)
    audit2 = AuditResult(
        audit_id="audit-ep-002",
        agent_id="agent-endpoint-001",
        overall_risk_score=82,
        total_risks_detected=4,
        critical_count=0,
        high_count=1,
        pillar_scores={},
        detected_risks=[],
        timestamp=datetime.utcnow(),
    )
    audit_results_store[audit2.audit_id] = audit2

    client.post(
        "/api/v1/passport/issue",
        params={
            "audit_id": "audit-ep-002",
            "agent_id": "agent-endpoint-001",
        },
    )

    # List passports
    response = client.get("/api/v1/passport/agent/agent-endpoint-001")

    assert response.status_code == 200
    result = response.json()
    assert result["total"] == 2
    assert len(result["passports"]) == 2
    assert all(p["agent_id"] == "agent-endpoint-001" for p in result["passports"])


# ============================================================================
# ERROR HANDLING TESTS
# ============================================================================

def test_issue_passport_endpoint_missing_params(client):
    """Test POST /api/v1/passport/issue with missing required params."""
    response = client.post("/api/v1/passport/issue")

    assert response.status_code == 422  # Unprocessable entity


def test_validate_passport_endpoint_invalid_json(client):
    """Test POST /api/v1/passport/validate with invalid JSON."""
    response = client.post(
        "/api/v1/passport/validate",
        json={"invalid_field": "value"},  # Missing passport_id
    )

    assert response.status_code == 422


# ============================================================================
# HEALTH CHECK TEST
# ============================================================================

def test_health_check_endpoint(client):
    """Test GET /health endpoint."""
    response = client.get("/health")

    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "healthy"
    assert result["service"] == "shadow-audit-api-v1"
    assert "timestamp" in result


# ============================================================================
# HEXAGON FRAMEWORK ENDPOINT TEST
# ============================================================================

def test_list_hexagon_risks_endpoint(client):
    """Test GET /api/v1/hexagon/risks endpoint."""
    response = client.get("/api/v1/hexagon/risks")

    assert response.status_code == 200
    result = response.json()
    assert result["total"] >= 130  # At least 130 risks
    assert len(result["risks"]) >= 130
    assert all("risk_id" in r for r in result["risks"])
    assert all("pillar" in r for r in result["risks"])
    assert all("severity" in r for r in result["risks"])
