"""
Data models for Agent Shadow Audit API.
- Pydantic schemas for FastAPI request/response
- Enums for risk levels, pillars, etc.
- W3C VC-compatible Agent Passport schema
"""

from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime, timedelta
from typing import List, Dict, Optional


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
    """Represents a detected risk."""
    risk_id: str = Field(..., description="Hexagon risk ID (e.g., HX-1-01)")
    risk_name: str = Field(..., description="Human-readable risk name")
    pillar: AuditPillar = Field(..., description="Which pillar this risk belongs to")
    severity: RiskLevel = Field(..., description="Risk severity")
    description: str = Field(..., description="What was detected and why it's a risk")
    recommendation: str = Field(..., description="How to remediate")
    confidence: float = Field(..., ge=0, le=1, description="Detection confidence (0.0-1.0)")
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
    
    class Config:
        schema_extra = {
            "example": {
                "agent_id": "agent-xyz-123",
                "context": {
                    "logs": "...",
                    "system_context": "...",
                    "env_config": {},
                    "consent_log": {},
                    "audit_config": {},
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
        description="All detected risks"
    )
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat(),
            RiskLevel: lambda v: v.value,
            AuditPillar: lambda v: v.value,
        }


class PassportClaim(BaseModel):
    """A single verifiable claim in an Agent Passport."""
    claim_id: str = Field(..., description="Unique claim ID")
    claim_type: str = Field(
        ...,
        description="Type of claim (e.g., risk_assessment, data_exposure_score)"
    )
    claim_value: str = Field(..., description="The claim value")
    context: str = Field(default="", description="Additional context")
    issued_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime = Field(
        default_factory=lambda: datetime.utcnow() + timedelta(days=30),
        description="When this claim expires (30 days by default)"
    )
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat(),
        }


class AgentPassport(BaseModel):
    """
    Agent Passport credential (W3C VC-compatible).
    
    Schema:
    - passport_id: unique identifier
    - agent_id: the agent holding this passport
    - audit_id: the audit this credential is based on
    - claims: list of verifiable claims
    - risk_level: overall risk rating
    - overall_score: numeric risk score
    """
    passport_id: str = Field(..., description="Unique passport ID")
    agent_id: str = Field(..., description="Agent UUID")
    audit_id: str = Field(..., description="Source audit ID")
    claims: List[PassportClaim] = Field(default_factory=list, description="Verifiable claims")
    issued_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime = Field(
        default_factory=lambda: datetime.utcnow() + timedelta(days=30)
    )
    risk_level: str = Field(
        default="APPROVED",
        description="Risk rating: APPROVED, APPROVED_WITH_CONSTRAINTS, UNDER_REVIEW, REJECTED"
    )
    overall_score: int = Field(default=100, ge=0, le=100, description="Overall risk score")
    
    class Config:
        json_encoders = {
            datetime: lambda v: v.isoformat(),
        }
        schema_extra = {
            "example": {
                "passport_id": "passport-abc123def456",
                "agent_id": "agent-xyz-123",
                "audit_id": "audit-789ghi",
                "claims": [
                    {
                        "claim_id": "claim-001",
                        "claim_type": "risk_assessment",
                        "claim_value": "75",
                        "context": "Overall risk score",
                        "issued_at": "2026-10-15T16:20:00Z",
                        "expires_at": "2026-11-14T16:20:00Z"
                    }
                ],
                "risk_level": "APPROVED_WITH_CONSTRAINTS",
                "overall_score": 75
            }
        }
