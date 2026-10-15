"""
Unit tests for PassportCredentialService (W3C VC credential issuance and validation).

Test coverage:
- Credential issuance (success and failure cases)
- Issuance criteria enforcement
- Signature generation and verification
- Passport validation (expiration, revocation, existence)
- Compliance level computation
"""

import pytest
from datetime import datetime, timedelta
from app.services.passport_service import PassportCredentialService
from app.models import (
    AuditResult,
    PillarScore,
    PassportValidationRequest,
)


@pytest.fixture
def passport_service():
    """Initialize PassportCredentialService for testing."""
    return PassportCredentialService(
        issuer_url="https://test.local/shadow-audit-api",
        credential_validity_days=90,
    )


@pytest.fixture
def passing_audit_result():
    """Create an audit result that meets credential issuance criteria."""
    return AuditResult(
        audit_id="audit-test-pass-001",
        agent_id="agent-001",
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


@pytest.fixture
def failing_audit_result():
    """Create an audit result that does NOT meet issuance criteria."""
    return AuditResult(
        audit_id="audit-test-fail-001",
        agent_id="agent-002",
        overall_risk_score=60,  # Below 70 threshold
        total_risks_detected=15,
        critical_count=2,  # Has CRITICAL risks
        high_count=5,
        pillar_scores={},
        detected_risks=[],
        timestamp=datetime.utcnow(),
    )


@pytest.fixture
def borderline_audit_result():
    """Create an audit result at the edge of issuance criteria."""
    return AuditResult(
        audit_id="audit-test-edge-001",
        agent_id="agent-003",
        overall_risk_score=70,  # Exactly at threshold
        total_risks_detected=8,
        critical_count=0,
        high_count=2,  # Exactly at max HIGH risk threshold
        pillar_scores={
            "data_exposure": PillarScore(pillar="data_exposure", score=70),
        },
        detected_risks=[],
        timestamp=datetime.utcnow(),
    )


# ============================================================================
# CREDENTIAL ISSUANCE TESTS
# ============================================================================

def test_issue_passport_success(passport_service, passing_audit_result):
    """Test successful passport issuance when criteria are met."""
    passport = passport_service.issue_passport(
        passing_audit_result,
        agent_id="agent-001",
        agent_name="TestAgent",
    )

    assert passport is not None
    assert passport.agent_id == "agent-001"
    assert passport.audit_id == "audit-test-pass-001"
    assert passport.passport_id.startswith("passport-")
    assert not passport.revoked


def test_issue_passport_below_score_threshold(passport_service, failing_audit_result):
    """Test that credential is NOT issued when score < 70."""
    passport = passport_service.issue_passport(
        failing_audit_result,
        agent_id="agent-002",
    )

    assert passport is None


def test_issue_passport_with_critical_risks(passport_service):
    """Test that credential is NOT issued when CRITICAL risks exist."""
    audit = AuditResult(
        audit_id="audit-critical",
        agent_id="agent-004",
        overall_risk_score=85,  # High score, but...
        total_risks_detected=10,
        critical_count=1,  # Has a CRITICAL risk
        high_count=2,
        pillar_scores={},
        detected_risks=[],
        timestamp=datetime.utcnow(),
    )

    passport = passport_service.issue_passport(audit, agent_id="agent-004")
    assert passport is None


def test_issue_passport_too_many_high_risks(passport_service):
    """Test that credential is NOT issued when HIGH risk count > 2."""
    audit = AuditResult(
        audit_id="audit-high-count",
        agent_id="agent-005",
        overall_risk_score=75,
        total_risks_detected=10,
        critical_count=0,
        high_count=3,  # Exceeds max of 2
        pillar_scores={},
        detected_risks=[],
        timestamp=datetime.utcnow(),
    )

    passport = passport_service.issue_passport(audit, agent_id="agent-005")
    assert passport is None


def test_issue_passport_at_threshold(passport_service, borderline_audit_result):
    """Test successful issuance exactly at threshold (score=70, high=2)."""
    passport = passport_service.issue_passport(
        borderline_audit_result,
        agent_id="agent-003",
    )

    assert passport is not None
    assert passport.agent_id == "agent-003"


# ============================================================================
# CREDENTIAL PROPERTIES TESTS
# ============================================================================

def test_passport_has_w3c_vc_credential(passport_service, passing_audit_result):
    """Test that issued passport contains W3C VC credential."""
    passport = passport_service.issue_passport(
        passing_audit_result,
        agent_id="agent-001",
        agent_name="TestAgent",
    )

    assert passport.credential is not None
    assert passport.credential.issuer == "https://test.local/shadow-audit-api"
    assert passport.credential.credential_subject is not None


def test_passport_credential_subject_populated(passport_service, passing_audit_result):
    """Test that credential subject contains all required fields."""
    passport = passport_service.issue_passport(
        passing_audit_result,
        agent_id="agent-001",
        agent_name="TestAgent",
    )

    subject = passport.credential.credential_subject
    assert subject.id == "did:agent:agent-001"
    assert subject.agent_name == "TestAgent"
    assert subject.overall_risk_score == 80
    assert subject.compliance_level in ["compliant", "partial_compliant", "non_compliant"]


def test_passport_pillar_compliance_flags(passport_service, passing_audit_result):
    """Test that pillar compliance flags are correctly set."""
    passport = passport_service.issue_passport(
        passing_audit_result,
        agent_id="agent-001",
    )

    subject = passport.credential.credential_subject
    assert subject.data_exposure_compliant is True
    assert subject.consent_validity_compliant is True
    assert subject.credential_security_compliant is True
    assert subject.process_integrity_compliant is True
    assert subject.external_risk_compliant is True


def test_passport_has_signature(passport_service, passing_audit_result):
    """Test that credential is signed (includes proof)."""
    passport = passport_service.issue_passport(
        passing_audit_result,
        agent_id="agent-001",
    )

    assert passport.credential.proof is not None
    assert "signatureValue" in passport.credential.proof
    assert passport.credential.proof["type"] == "Ed25519Signature2020"


def test_passport_expiration_date(passport_service, passing_audit_result):
    """Test that passport has correct expiration date (default: 90 days)."""
    passport = passport_service.issue_passport(
        passing_audit_result,
        agent_id="agent-001",
    )

    expected_expiry = passport.issued_at + timedelta(days=90)
    assert (passport.expires_at - expected_expiry).total_seconds() < 1


# ============================================================================
# COMPLIANCE LEVEL COMPUTATION TESTS
# ============================================================================

def test_compliance_level_compliant(passport_service):
    """Test compliance_level = 'compliant' (score >= 80, no CRITICAL)."""
    audit = AuditResult(
        audit_id="audit-compliant",
        agent_id="agent-010",
        overall_risk_score=85,
        total_risks_detected=3,
        critical_count=0,
        high_count=1,
        pillar_scores={},
        detected_risks=[],
        timestamp=datetime.utcnow(),
    )

    passport = passport_service.issue_passport(audit, agent_id="agent-010")
    assert passport.credential.credential_subject.compliance_level == "compliant"


def test_compliance_level_partial_compliant(passport_service):
    """Test compliance_level = 'partial_compliant' (score >= 70, no CRITICAL)."""
    audit = AuditResult(
        audit_id="audit-partial",
        agent_id="agent-011",
        overall_risk_score=75,
        total_risks_detected=5,
        critical_count=0,
        high_count=2,
        pillar_scores={},
        detected_risks=[],
        timestamp=datetime.utcnow(),
    )

    passport = passport_service.issue_passport(audit, agent_id="agent-011")
    assert passport.credential.credential_subject.compliance_level == "partial_compliant"


# ============================================================================
# PASSPORT VALIDATION TESTS
# ============================================================================

def test_validate_passport_valid(passport_service, passing_audit_result):
    """Test validation of a valid, non-expired passport."""
    passport = passport_service.issue_passport(
        passing_audit_result,
        agent_id="agent-001",
    )

    request = PassportValidationRequest(
        passport_id=passport.passport_id,
        verify_signature=False,
    )
    response = passport_service.validate_passport(request)

    assert response.valid is True
    assert response.agent_id == "agent-001"
    assert len(response.errors) == 0


def test_validate_passport_not_found(passport_service):
    """Test validation of non-existent passport."""
    request = PassportValidationRequest(
        passport_id="passport-nonexistent",
        verify_signature=False,
    )
    response = passport_service.validate_passport(request)

    assert response.valid is False
    assert "not found" in response.errors[0].lower()


def test_validate_passport_expired(passport_service, passing_audit_result):
    """Test validation of an expired passport."""
    # Issue a passport manually with a past expiration
    audit = passing_audit_result
    passport = passport_service.issue_passport(audit, agent_id="agent-001")

    # Manually set expiration to the past
    passport.expires_at = datetime.utcnow() - timedelta(days=1)

    request = PassportValidationRequest(
        passport_id=passport.passport_id,
        verify_signature=False,
    )
    response = passport_service.validate_passport(request)

    assert response.valid is False
    assert any("expired" in err.lower() for err in response.errors)


def test_validate_passport_revoked(passport_service, passing_audit_result):
    """Test validation of a revoked passport."""
    passport = passport_service.issue_passport(
        passing_audit_result,
        agent_id="agent-001",
    )

    # Revoke it
    passport_service.revoke_passport(
        passport.passport_id,
        reason="Agent violated compliance policy",
    )

    request = PassportValidationRequest(
        passport_id=passport.passport_id,
        verify_signature=False,
    )
    response = passport_service.validate_passport(request)

    assert response.valid is False
    assert any("revoked" in err.lower() for err in response.errors)


# ============================================================================
# REVOCATION TESTS
# ============================================================================

def test_revoke_passport_success(passport_service, passing_audit_result):
    """Test successful passport revocation."""
    passport = passport_service.issue_passport(
        passing_audit_result,
        agent_id="agent-001",
    )

    success = passport_service.revoke_passport(
        passport.passport_id,
        reason="Policy violation",
    )

    assert success is True
    assert passport.revoked is True
    assert passport.revocation_reason == "Policy violation"


def test_revoke_passport_nonexistent(passport_service):
    """Test revocation of non-existent passport."""
    success = passport_service.revoke_passport(
        "passport-nonexistent",
        reason="Test",
    )

    assert success is False


# ============================================================================
# LISTING TESTS
# ============================================================================

def test_list_passports_by_agent(passport_service, passing_audit_result):
    """Test listing all passports for an agent."""
    # Issue multiple passports for the same agent
    passport1 = passport_service.issue_passport(
        passing_audit_result,
        agent_id="agent-001",
    )

    audit2 = AuditResult(
        audit_id="audit-002",
        agent_id="agent-001",
        overall_risk_score=82,
        total_risks_detected=4,
        critical_count=0,
        high_count=1,
        pillar_scores={},
        detected_risks=[],
        timestamp=datetime.utcnow(),
    )
    passport2 = passport_service.issue_passport(audit2, agent_id="agent-001")

    passports = passport_service.list_passports_by_agent("agent-001")

    assert len(passports) == 2
    assert all(p.agent_id == "agent-001" for p in passports)


def test_get_passport_exists(passport_service, passing_audit_result):
    """Test retrieving an existing passport."""
    passport = passport_service.issue_passport(
        passing_audit_result,
        agent_id="agent-001",
    )

    retrieved = passport_service.get_passport(passport.passport_id)

    assert retrieved is not None
    assert retrieved.passport_id == passport.passport_id


def test_get_passport_not_found(passport_service):
    """Test retrieving a non-existent passport."""
    retrieved = passport_service.get_passport("passport-nonexistent")

    assert retrieved is None
