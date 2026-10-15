"""
Core domain models for Shadow Audit API.
Pydantic schemas for request/response validation and serialization.
"""

from datetime import datetime
from enum import Enum
from typing import Optional, Dict, List
from pydantic import BaseModel, Field


class RiskLevel(str, Enum):
    """Risk severity levels (Hexagon Framework)."""
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INFO = "info"


class AuditPillar(str, Enum):
    """Five audit pillars from Hexagon Framework."""
    DATA_EXPOSURE = "data_exposure"
    CONSENT_VALIDITY = "consent_validity"
    CREDENTIAL_SECURITY = "credential_security"
    PROCESS_INTEGRITY = "process_integrity"
    EXTERNAL_RISK = "external_risk"


class RiskDetection(BaseModel):
    """Represents a single detected risk (Hexagon framework)."""
    risk_id: str = Field(..., description="Unique risk identifier (e.g., HX-001)")
    risk_name: str = Field(..., description="Human-readable risk name")
    pillar: AuditPillar = Field(..., description="Audit pillar this risk belongs to")
    severity: RiskLevel = Field(..., description="Risk severity level")
    description: str = Field(..., description="Detailed risk description")
    recommendation: str = Field(..., description="Remediation action")
    evidence: Optional[Dict] = Field(default=None, description="Evidence supporting detection")
    confidence: float = Field(..., ge=0, le=1, description="Confidence score (0-1)")


class RiskScore(BaseModel):
    """Risk score for a single pillar."""
    pillar: AuditPillar
    score: float = Field(..., ge=0, le=100, description="Pillar score (0-100)")
    detected_risks: List[RiskDetection] = Field(default_factory=list)
    remediation_priority: int = Field(..., ge=1, le=5, description="1=highest, 5=lowest")


class AuditResult(BaseModel):
    """Complete audit result for an agent."""
    audit_id: str = Field(..., description="Unique audit identifier")
    agent_id: str = Field(..., description="Agent being audited")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    
    # Pillar scores
    pillar_scores: Dict[str, RiskScore] = Field(default_factory=dict)
    
    # Overall metrics
    overall_risk_score: float = Field(..., ge=0, le=100, description="Aggregate risk (0-100)")
    total_risks_detected: int = Field(default=0)
    critical_count: int = Field(default=0)
    high_count: int = Field(default=0)
    
    # Status
    status: str = Field(default="pending", description="audit|pending|completed|failed")
    error_message: Optional[str] = None


class PassportClaim(BaseModel):
    """Individual claim in an Agent Passport (W3C Verifiable Credential)."""
    claim_id: str
    claim_type: str  # e.g., "risk_score", "consent_validity", "data_handling"
    issuer: str = "myprivacytool-shadow-audit"
    issued_at: datetime
    expires_at: Optional[datetime] = None
    evidence: Dict = Field(default_factory=dict)
    status: str = "active"  # active | revoked | expired


class AgentPassport(BaseModel):
    """
    W3C Verifiable Credential format for Agent Passport.
    Represents audit results as cryptographically signed credentials.
    """
    passport_id: str = Field(..., description="Unique credential ID")
    agent_id: str
    issuer: str = "myprivacytool-shadow-audit"
    issued_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: Optional[datetime] = None
    
    # Claims
    claims: List[PassportClaim] = Field(default_factory=list)
    
    # Signature (Ed25519)
    proof: Optional[Dict] = None  # Will contain signature + verification method
    
    # Reference to audit
    audit_id: Optional[str] = None
    audit_result: Optional[AuditResult] = None


class TriggerAuditRequest(BaseModel):
    """Request to trigger an audit for an agent."""
    agent_id: str
    audit_type: str = "shadow"  # shadow | invasive | spot-check
    include_passport: bool = True


class TriggerAuditResponse(BaseModel):
    """Response to audit trigger."""
    audit_id: str
    agent_id: str
    status: str
    created_at: datetime


class RetrieveAuditRequest(BaseModel):
    """Request to retrieve audit results."""
    audit_id: str


class RemediateAuditRequest(BaseModel):
    """Request to remediate detected risks."""
    audit_id: str
    risks_to_remediate: List[str]  # List of risk_ids
    remediation_actions: Dict[str, str]  # {risk_id: action_description}


class HealthCheckResponse(BaseModel):
    """Health check response."""
    status: str
    timestamp: datetime
    version: str = "1.0.0"
    services: Dict[str, str] = Field(default_factory=dict)  # {service: status}
