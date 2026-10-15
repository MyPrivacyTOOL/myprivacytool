"""
Unit tests for RiskScorer — TDD approach.
Tests scoring logic, pillar aggregation, and risk detection aggregation.
"""

import pytest
from datetime import datetime
from app.models import (
    AuditResult, RiskDetection, RiskScore, AuditPillar, RiskLevel
)
from app.scorer import RiskScorer


@pytest.fixture
def scorer():
    """Fixture: Initialize RiskScorer."""
    return RiskScorer()


class TestRiskScorer:
    """Test suite for RiskScorer."""
    
    def test_scorer_initialization(self, scorer):
        """Test scorer initializes with empty state."""
        assert scorer is not None
        assert hasattr(scorer, 'detect_pii_exposure')
        assert hasattr(scorer, 'detect_credential_exposure')
        assert hasattr(scorer, 'detect_consent_issues')
    
    def test_detect_pii_exposure_email(self, scorer):
        """Test PII detection: email in context."""
        context = "User email: john.doe@example.com contacted support."
        detected = scorer.detect_pii_exposure(context)
        assert detected is not None
        assert detected.risk_id == "HX-1-01"
        assert detected.severity == RiskLevel.CRITICAL
    
    def test_detect_pii_exposure_phone(self, scorer):
        """Test PII detection: phone number in context."""
        context = "Customer phone: +1-555-123-4567 called at 3pm."
        detected = scorer.detect_pii_exposure(context)
        assert detected is not None
        assert detected.risk_id == "HX-1-01"
    
    def test_detect_pii_exposure_ssn(self, scorer):
        """Test PII detection: SSN in context."""
        context = "SSN 123-45-6789 verified in background check."
        detected = scorer.detect_pii_exposure(context)
        assert detected is not None
        assert detected.risk_id == "HX-1-01"
    
    def test_detect_pii_exposure_none(self, scorer):
        """Test no PII detection when context is safe."""
        context = "Processing user request completed successfully."
        detected = scorer.detect_pii_exposure(context)
        assert detected is None
    
    def test_detect_credential_exposure_api_key(self, scorer):
        """Test credential detection: API key in logs."""
        logs = "API key sk_live_4eC39HqLyjWDarhtT657 used for request."
        detected = scorer.detect_credential_exposure(logs)
        assert detected is not None
        assert detected.risk_id == "HX-1-02"
        assert detected.severity == RiskLevel.CRITICAL
    
    def test_detect_credential_exposure_token_pattern(self, scorer):
        """Test credential detection: token pattern in response."""
        response = 'Authorization: Bearer [SENSITIVE_TOKEN_PATTERN]'
        detected = scorer.detect_credential_exposure(response)
        assert detected is not None
        assert detected.risk_id == "HX-1-02"
    
    def test_detect_credential_exposure_none(self, scorer):
        """Test no credential detection when safe."""
        safe_response = 'Response: {status: "success", message: "data processed"}'
        detected = scorer.detect_credential_exposure(safe_response)
        assert detected is None
    
    def test_calculate_pillar_score_single_risk(self, scorer):
        """Test pillar score calculation with one risk."""
        risk = RiskDetection(
            risk_id="HX-1-01",
            risk_name="PII Exposure",
            pillar=AuditPillar.DATA_EXPOSURE,
            severity=RiskLevel.CRITICAL,
            description="Test",
            recommendation="Test",
            confidence=1.0
        )
        score = scorer.calculate_pillar_score(
            AuditPillar.DATA_EXPOSURE,
            [risk]
        )
        assert score.pillar == AuditPillar.DATA_EXPOSURE
        assert score.score < 100  # Should be penalized
        assert len(score.detected_risks) == 1
    
    def test_calculate_pillar_score_multiple_risks(self, scorer):
        """Test pillar score with multiple risks."""
        risks = [
            RiskDetection(
                risk_id="HX-1-01",
                risk_name="PII Exposure",
                pillar=AuditPillar.DATA_EXPOSURE,
                severity=RiskLevel.CRITICAL,
                description="Test",
                recommendation="Test",
                confidence=1.0
            ),
            RiskDetection(
                risk_id="HX-1-02",
                risk_name="Credential Exposure",
                pillar=AuditPillar.DATA_EXPOSURE,
                severity=RiskLevel.CRITICAL,
                description="Test",
                recommendation="Test",
                confidence=0.95
            ),
        ]
        score = scorer.calculate_pillar_score(
            AuditPillar.DATA_EXPOSURE,
            risks
        )
        assert score.score < 50  # Two critical risks = severe penalty
        assert len(score.detected_risks) == 2
    
    def test_calculate_pillar_score_no_risks(self, scorer):
        """Test pillar score calculation with no risks."""
        score = scorer.calculate_pillar_score(
            AuditPillar.DATA_EXPOSURE,
            []
        )
        assert score.score == 100  # No risks = perfect score
        assert len(score.detected_risks) == 0
    
    def test_aggregate_pillar_scores_to_overall(self, scorer):
        """Test aggregating 5 pillar scores to overall risk."""
        pillar_scores = {
            AuditPillar.DATA_EXPOSURE.value: RiskScore(
                pillar=AuditPillar.DATA_EXPOSURE,
                score=40,
                detected_risks=[],
                remediation_priority=1
            ),
            AuditPillar.CONSENT_VALIDITY.value: RiskScore(
                pillar=AuditPillar.CONSENT_VALIDITY,
                score=60,
                detected_risks=[],
                remediation_priority=2
            ),
            AuditPillar.CREDENTIAL_SECURITY.value: RiskScore(
                pillar=AuditPillar.CREDENTIAL_SECURITY,
                score=50,
                detected_risks=[],
                remediation_priority=1
            ),
            AuditPillar.PROCESS_INTEGRITY.value: RiskScore(
                pillar=AuditPillar.PROCESS_INTEGRITY,
                score=70,
                detected_risks=[],
                remediation_priority=3
            ),
            AuditPillar.EXTERNAL_RISK.value: RiskScore(
                pillar=AuditPillar.EXTERNAL_RISK,
                score=80,
                detected_risks=[],
                remediation_priority=3
            ),
        }
        
        overall = scorer.aggregate_pillar_scores(pillar_scores)
        
        # Overall should be weighted average of 5 pillars
        assert 0 <= overall <= 100
        # With these scores, should be around 60
        assert 55 <= overall <= 65
    
    def test_severity_weight_mapping(self, scorer):
        """Test that severity levels are properly weighted in scoring."""
        critical_risk = RiskDetection(
            risk_id="test-critical",
            risk_name="Test",
            pillar=AuditPillar.DATA_EXPOSURE,
            severity=RiskLevel.CRITICAL,
            description="Test",
            recommendation="Test",
            confidence=1.0
        )
        info_risk = RiskDetection(
            risk_id="test-info",
            risk_name="Test",
            pillar=AuditPillar.DATA_EXPOSURE,
            severity=RiskLevel.INFO,
            description="Test",
            recommendation="Test",
            confidence=1.0
        )
        
        critical_score = scorer.calculate_pillar_score(
            AuditPillar.DATA_EXPOSURE, [critical_risk]
        ).score
        info_score = scorer.calculate_pillar_score(
            AuditPillar.DATA_EXPOSURE, [info_risk]
        ).score
        
        # Critical risk should yield much lower score than info risk
        assert critical_score < info_score
    
    def test_confidence_score_impact(self, scorer):
        """Test that confidence affects risk weighting."""
        high_conf_risk = RiskDetection(
            risk_id="test-high",
            risk_name="Test",
            pillar=AuditPillar.DATA_EXPOSURE,
            severity=RiskLevel.HIGH,
            description="Test",
            recommendation="Test",
            confidence=0.99
        )
        low_conf_risk = RiskDetection(
            risk_id="test-low",
            risk_name="Test",
            pillar=AuditPillar.DATA_EXPOSURE,
            severity=RiskLevel.HIGH,
            description="Test",
            recommendation="Test",
            confidence=0.30
        )
        
        high_conf_score = scorer.calculate_pillar_score(
            AuditPillar.DATA_EXPOSURE, [high_conf_risk]
        ).score
        low_conf_score = scorer.calculate_pillar_score(
            AuditPillar.DATA_EXPOSURE, [low_conf_risk]
        ).score
        
        # Higher confidence should yield lower score (more impact)
        assert high_conf_score < low_conf_score


class TestAuditResultConstruction:
    """Tests for building AuditResult objects."""
    
    def test_audit_result_creation(self):
        """Test creating an AuditResult."""
        result = AuditResult(
            audit_id="audit-001",
            agent_id="agent-xyz",
            overall_risk_score=45,
            total_risks_detected=3,
            critical_count=1,
            high_count=2
        )
        
        assert result.audit_id == "audit-001"
        assert result.agent_id == "agent-xyz"
        assert result.overall_risk_score == 45
        assert isinstance(result.timestamp, datetime)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
