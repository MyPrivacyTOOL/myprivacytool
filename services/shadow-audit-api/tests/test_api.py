"""
Test suite for Shadow Audit API endpoints.
- Audit trigger and result retrieval
- Passport issuance and validation
- Risk scoring and aggregation
"""

import pytest
from fastapi.testclient import TestClient
from datetime import datetime, timedelta
from app.main import app
from app.models import AuditRequest, RiskLevel, AuditPillar


client = TestClient(app)


class TestHealthCheck:
    """Test health check endpoint."""
    
    def test_health_check_success(self):
        """Should return 200 with healthy status."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["service"] == "shadow-audit-api-v1"
        assert "timestamp" in data


class TestAuditEndpoints:
    """Test audit trigger and retrieval endpoints."""
    
    def test_run_audit_success(self):
        """POST /api/v1/audit/run should return AuditResult."""
        request_payload = {
            "agent_id": "test-agent-001",
            "context": {
                "logs": "Agent activity log...",
                "system_context": {"env": "test"},
                "env_config": {"SECRET_HANDLER": "mock"},
                "consent_log": {"user_scans": 5},
                "audit_config": {"level": "full"},
            }
        }
        
        response = client.post("/api/v1/audit/run", json=request_payload)
        assert response.status_code == 200
        
        result = response.json()
        assert "audit_id" in result
        assert result["agent_id"] == "test-agent-001"
        assert "overall_risk_score" in result
        assert 0 <= result["overall_risk_score"] <= 100
        assert "timestamp" in result
        assert "pillar_scores" in result
    
    def test_run_audit_missing_agent_id(self):
        """Should fail if agent_id is missing."""
        response = client.post("/api/v1/audit/run", json={"context": {}})
        assert response.status_code == 422  # Validation error
    
    def test_get_audit_result_success(self):
        """GET /api/v1/audit/{audit_id} should retrieve stored result."""
        # First, run an audit
        request_payload = {
            "agent_id": "test-agent-002",
            "context": {"logs": "test"}
        }
        audit_response = client.post("/api/v1/audit/run", json=request_payload)
        audit_id = audit_response.json()["audit_id"]
        
        # Then retrieve it
        response = client.get(f"/api/v1/audit/{audit_id}")
        assert response.status_code == 200
        
        result = response.json()
        assert result["audit_id"] == audit_id
        assert result["agent_id"] == "test-agent-002"
    
    def test_get_audit_result_not_found(self):
        """Should return 404 if audit_id doesn't exist."""
        response = client.get("/api/v1/audit/nonexistent-audit-id")
        assert response.status_code == 404
        data = response.json()
        assert "not found" in data["detail"].lower()


class TestPassportEndpoints:
    """Test Agent Passport issuance and validation."""
    
    def test_issue_passport_success(self):
        """POST /api/v1/passport/issue should return AgentPassport."""
        # Run an audit first
        request_payload = {
            "agent_id": "test-agent-003",
            "context": {"logs": "test context"}
        }
        audit_response = client.post("/api/v1/audit/run", json=request_payload)
        audit_id = audit_response.json()["audit_id"]
        
        # Issue passport
        response = client.post(
            "/api/v1/passport/issue",
            params={"audit_id": audit_id}
        )
        assert response.status_code == 200
        
        passport = response.json()
        assert "passport_id" in passport
        assert passport["agent_id"] == "test-agent-003"
        assert passport["audit_id"] == audit_id
        assert "claims" in passport
        assert isinstance(passport["claims"], list)
        assert len(passport["claims"]) >= 2  # Should have at least 2 claims
        assert "risk_level" in passport
        assert passport["risk_level"] in [
            "APPROVED", "APPROVED_WITH_CONSTRAINTS", "UNDER_REVIEW", "REJECTED"
        ]
        assert "overall_score" in passport
        assert 0 <= passport["overall_score"] <= 100
    
    def test_issue_passport_audit_not_found(self):
        """Should return 404 if audit_id doesn't exist."""
        response = client.post(
            "/api/v1/passport/issue",
            params={"audit_id": "nonexistent-audit"}
        )
        assert response.status_code == 404
    
    def test_passport_claims_have_expiry(self):
        """Passport claims should have issued_at and expires_at."""
        request_payload = {
            "agent_id": "test-agent-004",
            "context": {"logs": "test"}
        }
        audit_response = client.post("/api/v1/audit/run", json=request_payload)
        audit_id = audit_response.json()["audit_id"]
        
        passport_response = client.post(
            "/api/v1/passport/issue",
            params={"audit_id": audit_id}
        )
        passport = passport_response.json()
        
        assert "issued_at" in passport
        assert "expires_at" in passport
        
        for claim in passport["claims"]:
            assert "issued_at" in claim
            assert "expires_at" in claim
            # Expires in ~30 days
            issued = datetime.fromisoformat(claim["issued_at"].replace("Z", "+00:00"))
            expires = datetime.fromisoformat(claim["expires_at"].replace("Z", "+00:00"))
            delta = (expires - issued).days
            assert 25 <= delta <= 35  # Allow some flexibility


class TestRiskScoring:
    """Test risk scoring and detection logic."""
    
    def test_audit_detects_risks(self):
        """Audit should detect and score risks."""
        request_payload = {
            "agent_id": "test-agent-005",
            "context": {
                "logs": "Credential exposure detected in logs",
                "env_config": {"API_KEY": "exposed-key-12345"}
            }
        }
        
        response = client.post("/api/v1/audit/run", json=request_payload)
        result = response.json()
        
        # Should detect credential exposure risk
        assert result["total_risks_detected"] > 0
        assert result["critical_count"] >= 0
        assert result["high_count"] >= 0
    
    def test_pillar_scores_breakdown(self):
        """Audit result should include per-pillar scores."""
        request_payload = {
            "agent_id": "test-agent-006",
            "context": {"logs": "test"}
        }
        
        response = client.post("/api/v1/audit/run", json=request_payload)
        result = response.json()
        
        assert "pillar_scores" in result
        pillar_scores = result["pillar_scores"]
        
        # Should have at least some pillars scored
        assert isinstance(pillar_scores, dict)
        for pillar_name, score_obj in pillar_scores.items():
            assert "pillar" in score_obj
            assert "score" in score_obj
            assert 0 <= score_obj["score"] <= 100
            assert "detected_risks" in score_obj
            assert isinstance(score_obj["detected_risks"], list)


class TestHexagonFrameworkIntegration:
    """Test integration with Hexagon Framework."""
    
    def test_list_all_risks_endpoint(self):
        """GET /api/v1/hexagon/risks should list all framework risks."""
        response = client.get("/api/v1/hexagon/risks")
        assert response.status_code == 200
        
        data = response.json()
        assert "risks" in data
        assert "total" in data
        assert data["total"] > 0
        
        risks = data["risks"]
        for risk in risks:
            assert "risk_id" in risk
            assert "risk_name" in risk
            assert "pillar" in risk
            assert "severity" in risk
            assert risk["severity"] in ["critical", "high", "medium", "low", "info"]
            assert "description" in risk
            assert "recommendation" in risk
    
    def test_detected_risks_reference_framework(self):
        """Detected risks should reference valid Hexagon framework risk IDs."""
        request_payload = {
            "agent_id": "test-agent-007",
            "context": {"logs": "test"}
        }
        
        audit_response = client.post("/api/v1/audit/run", json=request_payload)
        audit_result = audit_response.json()
        
        # Get all framework risks
        framework_response = client.get("/api/v1/hexagon/risks")
        framework_risks = framework_response.json()["risks"]
        framework_risk_ids = {r["risk_id"] for r in framework_risks}
        
        # Check detected risks match framework
        if audit_result["detected_risks"]:
            for detected_risk in audit_result["detected_risks"]:
                assert detected_risk["risk_id"] in framework_risk_ids


class TestAuditResultIntegrity:
    """Test audit result data integrity and consistency."""
    
    def test_overall_score_consistency(self):
        """Overall risk score should be computed consistently."""
        request_payload = {
            "agent_id": "test-agent-008",
            "context": {"logs": "test context"}
        }
        
        # Run same audit twice
        response1 = client.post("/api/v1/audit/run", json=request_payload)
        response2 = client.post("/api/v1/audit/run", json=request_payload)
        
        result1 = response1.json()
        result2 = response2.json()
        
        # Should compute similar scores (allow 5pt difference for variance)
        score_diff = abs(result1["overall_risk_score"] - result2["overall_risk_score"])
        assert score_diff <= 5
    
    def test_pillar_scores_sum_sanely(self):
        """Pillar scores should make sense relative to overall score."""
        request_payload = {
            "agent_id": "test-agent-009",
            "context": {"logs": "test"}
        }
        
        response = client.post("/api/v1/audit/run", json=request_payload)
        result = response.json()
        
        overall = result["overall_risk_score"]
        pillar_scores = result["pillar_scores"]
        
        if pillar_scores:
            # Overall should be roughly the average of pillar scores
            pillar_values = [s["score"] for s in pillar_scores.values()]
            avg_pillar = sum(pillar_values) / len(pillar_values)
            
            # Within 10 points of average
            assert abs(overall - avg_pillar) <= 10


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
