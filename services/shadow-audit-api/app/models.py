"""
Data models for Agent Shadow Audit API v1 MVP.

Pydantic schemas for FastAPI request/response, enums for risk levels/pillars,
and W3C VC-compatible Agent Passport schema.

Key entities:
- RiskLevel, AuditPillar: Hexagon Framework enums
- RiskDetection: Individual risk detection result
- AuditResult: Complete audit run output
- AgentPassport: W3C VC-compatible credential proving audit compliance
"""

from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any


class RiskLevel(str, Enum):
    """Risk severity levels."""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class AuditPillar(str, Enum):
    """The 5 pillars of the Hexagon Framework."""
    DATA_EXPOSURE = "data_exposure"
    CREDENTIAL_SECURITY = "credential_security"
    CONSENT_VALIDITY = "consent_validity"
    PROCESS_INTEGRITY = "process_integrity"
    EXTERNAL_RISK = "external_risk"


class RiskDetection(BaseModel):
    """Represents a detected risk during audit."""
    risk_id: str = Field(..., description="Hexagon risk ID (e.g., HX-1-01)")
    risk_name: str = Field(..., description="Human-readable risk name")
    pillar: AuditPillar = Field(..., description="Which pillar this risk belongs to")
    severity: RiskLevel = Field(..., description="Risk severity")
    description: str = Field(..., description="What was detected and why it's a risk")
    recommendation: str = Field(..., description="How to remediate")
    confidence: float = Field(..., ge=0, le=1, description="Detection confidence (0.0-1.0)")
    evidence: Optional[str] = Field(None, description="Specific evidence of the risk (PII patterns, etc.)")
    detected_at: Optional[datetime] = Field(default_factory=datetime.utcnow)
    
    class Config:
        use_enum_values = True


class RiskScore(BaseModel):
    """Risk score for a single pillar."""
    pillar: AuditPillar = Field(..., description="The pillar being scored")
    score: int = Field(..., ge=0, le=100, description="Risk score 0-100 (100=safe)")
    detected_risks: List[RiskDetection] = Field(default_factory=list)
    remediation_priority: int = Field(..., ge=1, le=5, description="1=urgent, 5=backlog")
    
    class Config:
        use_enum_values = False


class AuditRequest(BaseModel):
    """Request body for POST /api/v1/audit/run."""
    agent_id: str = Field(..., description="Agent UUID to audit")
    context: Dict = Field(
        default_factory=dict,
        description="Agent context: logs, environment, consent, config"
    )
    pillar: Optional[AuditPillar] = Field(None, description="Optional: audit specific pillar only")
    issue_passport: bool = Field(
        default=True,
        description="Issue passport credential if audit passes"
    )
    
    class Config:
        schema_extra = {
            "example": {
                "agent_id": "agent-xyz-123",
                "pillar": None,
                "issue_passport": True,
                "context": {
                    "logs": "...",
                    "system_context": "...",
                    "env_config": {},
                    "consent_log": {},
                }
            }
        }


class AuditResult(BaseModel):
    """Response from POST /api/v1/audit/run."""
    audit_id: str = Field(..., description="Unique audit identifier")
    agent_id: str = Field(..., description="The agent audited")
    overall_risk_score: int = Field(
        ..., ge=0, le=100,
        description="Overall risk 0-100 (100=safe, 0=critical risk)"
    )
    total_risks_detected: int = Field(default=0, description="Total risks found")
    critical_count: int = Field(default=0, description="Number of CRITICAL risks")
    high_count: int = Field(default=0, description="Number of HIGH risks")
    pillar_scores: Optional[Dict[str, RiskScore]] = Field(
        default_factory=dict,
        description="Risk scores by pillar"
    )
    detected_risks: Optional[List[RiskDetection]] = Field(
        default_factory=list,
        description="All detected risks (MVP: top 10)"
    )
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat(),
            RiskLevel: lambda v: v.value,
            AuditPillar: lambda v: v.value,
        }


class PassportClaimVC(BaseModel):
    """
    A single verifiable claim in a W3C VC-compatible passport.
    """
    claim_id: str = Field(..., description="Unique claim ID within passport")
    claim_type: str = Field(
        ...,
        description="Type: risk_assessment, data_exposure_score, consent_score, etc."
    )
    claim_value: str = Field(..., description="The claim value (string representation)")
    context: str = Field(default="", description="Additional context")
    issued_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime = Field(
        default_factory=lambda: datetime.utcnow() + timedelta(days=90),
        description="When this claim expires (90 days default)"
    )
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat(),
        }


class CredentialSubject(BaseModel):
    """
    W3C VC credential subject (the entity being described).
    """
    id: str = Field(..., description="Agent DID or identifier")
    agent_name: str
    agent_version: Optional[str] = None
    
    # Compliance claims by pillar
    data_exposure_compliant: bool
    consent_validity_compliant: bool
    credential_security_compliant: bool
    process_integrity_compliant: bool
    external_risk_compliant: bool
    
    # Overall assessment
    overall_risk_score: float = Field(..., ge=0, le=100)
    compliance_level: str = Field(
        ..., enum=["compliant", "partial_compliant", "non_compliant"],
        description="Overall compliance rating"
    )


class AgentPassportVC(BaseModel):
    """
    W3C Verifiable Credential (VC) for Agent Passport.
    
    Based on W3C VC Data Model: https://www.w3.org/TR/vc-data-model/
    
    A non-invasive credential proving an agent has passed a shadow audit
    against the Hexagon Framework. Can be presented to external systems,
    compliance auditors, or privilege escalation checks.
    """
    
    # VC metadata
    context: List[str] = Field(
        default=["https://www.w3.org/2018/credentials/v1"],
        description="JSON-LD context URIs"
    )
    type: List[str] = Field(
        default=["VerifiableCredential", "AgentAuditPassport"],
        description="Credential types"
    )
    issuer: str = Field(
        default="https://myprivacytool.io/shadow-audit-api",
        description="Credential issuer"
    )
    issuance_date: datetime = Field(
        default_factory=datetime.utcnow,
        description="When credential was issued"
    )
    expiration_date: datetime = Field(
        ...,
        description="When credential expires (typically 90 days)"
    )
    
    # Credential content
    credential_subject: CredentialSubject = Field(
        ...,
        description="Subject of the credential (the agent)"
    )
    
    # Proof (Ed25519 signature, populated during issuance)
    proof: Optional[Dict[str, Any]] = Field(
        None,
        description="Cryptographic proof (JWS or LD-Proof)"
    )
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat(),
        }
        schema_extra = {
            "example": {
                "context": ["https://www.w3.org/2018/credentials/v1"],
                "type": ["VerifiableCredential", "AgentAuditPassport"],
                "issuer": "https://myprivacytool.io/shadow-audit-api",
                "issuance_date": "2026-10-15T16:20:00Z",
                "expiration_date": "2027-01-13T16:20:00Z",
                "credential_subject": {
                    "id": "did:agent:xyz-123",
                    "agent_name": "MyPrivacyToolClaw",
                    "data_exposure_compliant": True,
                    "consent_validity_compliant": True,
                    "credential_security_compliant": True,
                    "process_integrity_compliant": True,
                    "external_risk_compliant": True,
                    "overall_risk_score": 78,
                    "compliance_level": "compliant"
                }
            }
        }


class AgentPassport(BaseModel):
    """
    Issued Agent Passport credential.
    
    Represents a non-invasive credential proving audit compliance.
    """
    passport_id: str = Field(..., description="Unique passport ID")
    agent_id: str = Field(..., description="Agent UUID")
    audit_id: str = Field(..., description="Source audit ID")
    
    # Credential content
    credential: AgentPassportVC = Field(
        ...,
        description="W3C VC credential"
    )
    
    # Lifecycle
    issued_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime = Field(..., description="Expiration date")
    revoked: bool = Field(default=False)
    revocation_reason: Optional[str] = None
    
    # Validation state
    is_valid: bool = Field(default=True)
    validation_errors: List[str] = Field(default_factory=list)
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat(),
        }


class PassportValidationRequest(BaseModel):
    """Request to validate a passport credential."""
    passport_id: str
    verify_signature: bool = Field(default=True, description="Verify Ed25519 signature")


class PassportValidationResponse(BaseModel):
    """Response from passport validation."""
    valid: bool
    passport_id: str
    agent_id: str
    expires_at: datetime
    errors: List[str] = Field(default_factory=list)
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat(),
        }
