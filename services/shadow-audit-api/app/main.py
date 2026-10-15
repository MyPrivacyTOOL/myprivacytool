"""
FastAPI application for Agent Shadow Audit API v1.
Endpoints:
- POST /api/v1/audit/run — Run full audit on agent context
- GET /api/v1/audit/{audit_id} — Retrieve audit result
- POST /api/v1/passport/issue — Issue Agent Passport credential
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from datetime import datetime, timedelta
from typing import Dict, Optional
import uuid
from app.scorer import RiskScorer
from app.models import (
    AuditRequest, AuditResult, AgentPassport, PassportClaim, RiskLevel
)

app = FastAPI(
    title="Agent Shadow Audit API",
    description="Non-invasive audit service for agent risk assessment",
    version="1.0.0"
)

# In-memory store for audit results (dev only — replace with DB)
audit_results_store: Dict[str, AuditResult] = {}

# Initialize scorer
scorer = RiskScorer()


@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "shadow-audit-api-v1",
        "timestamp": datetime.utcnow().isoformat()
    }


@app.post("/api/v1/audit/run")
def run_audit(request: AuditRequest) -> AuditResult:
    """
    Run a full audit on agent context.
    
    Input:
    - agent_id: str — agent to audit
    - context: Dict — agent context (logs, environment, consent, config)
    
    Output:
    - AuditResult with overall_risk_score (0-100) and pillar breakdown
    """
    try:
        # Generate audit ID
        audit_id = f"audit-{uuid.uuid4().hex[:12]}"
        
        # Run the audit
        audit_output = scorer.run_full_audit(request.context)
        
        # Build AuditResult
        result = AuditResult(
            audit_id=audit_id,
            agent_id=request.agent_id,
            overall_risk_score=audit_output['overall_risk_score'],
            total_risks_detected=audit_output['total_risks'],
            critical_count=audit_output['critical_count'],
            high_count=audit_output['high_count'],
            pillar_scores=audit_output['pillar_scores'],
            detected_risks=audit_output['all_detected_risks'],
            timestamp=datetime.utcnow()
        )
        
        # Store result (dev: in-memory; prod: database)
        audit_results_store[audit_id] = result
        
        return result
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/audit/{audit_id}")
def get_audit_result(audit_id: str) -> AuditResult:
    """
    Retrieve a previously executed audit result.
    """
    result = audit_results_store.get(audit_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Audit {audit_id} not found")
    
    return result


@app.post("/api/v1/passport/issue")
def issue_passport(audit_id: str) -> AgentPassport:
    """
    Issue an Agent Passport credential based on audit results.
    
    Input:
    - audit_id: str — the audit to base the passport on
    
    Output:
    - AgentPassport with W3C VC-compatible claims
    """
    # Fetch audit result
    audit_result = audit_results_store.get(audit_id)
    if not audit_result:
        raise HTTPException(status_code=404, detail=f"Audit {audit_id} not found")
    
    # Build passport claims
    risk_rating = _rate_risk(audit_result.overall_risk_score)
    
    claims = [
        PassportClaim(
            claim_id=f"claim-{uuid.uuid4().hex[:8]}",
            claim_type="risk_assessment",
            claim_value=str(audit_result.overall_risk_score),
            context=f"Overall risk score from audit {audit_id}",
            issued_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(days=30)
        ),
        PassportClaim(
            claim_id=f"claim-{uuid.uuid4().hex[:8]}",
            claim_type="risk_rating",
            claim_value=risk_rating,
            context=f"Risk classification: {risk_rating}",
            issued_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(days=30)
        ),
        PassportClaim(
            claim_id=f"claim-{uuid.uuid4().hex[:8]}",
            claim_type="data_exposure_score",
            claim_value=str(
                audit_result.pillar_scores.get('data_exposure').score
                if audit_result.pillar_scores.get('data_exposure')
                else 100
            ),
            context="Data exposure risk assessment",
            issued_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(days=30)
        ),
        PassportClaim(
            claim_id=f"claim-{uuid.uuid4().hex[:8]}",
            claim_type="credential_security_score",
            claim_value=str(
                audit_result.pillar_scores.get('credential_security').score
                if audit_result.pillar_scores.get('credential_security')
                else 100
            ),
            context="Credential security assessment",
            issued_at=datetime.utcnow(),
            expires_at=datetime.utcnow() + timedelta(days=30)
        ),
    ]
    
    passport = AgentPassport(
        passport_id=f"passport-{uuid.uuid4().hex[:12]}",
        agent_id=audit_result.agent_id,
        audit_id=audit_id,
        claims=claims,
        issued_at=datetime.utcnow(),
        expires_at=datetime.utcnow() + timedelta(days=30),
        risk_level=risk_rating,
        overall_score=audit_result.overall_risk_score
    )
    
    return passport


def _rate_risk(score: int) -> str:
    """
    Convert numeric risk score to rating.
    - 80+: APPROVED
    - 60-79: APPROVED_WITH_CONSTRAINTS
    - 40-59: UNDER_REVIEW
    - <40: REJECTED
    """
    if score >= 80:
        return "APPROVED"
    elif score >= 60:
        return "APPROVED_WITH_CONSTRAINTS"
    elif score >= 40:
        return "UNDER_REVIEW"
    else:
        return "REJECTED"


@app.get("/api/v1/hexagon/risks")
def list_all_risks():
    """
    List all risks in the Hexagon Framework.
    """
    from app.hexagon_framework import HEXAGON_FRAMEWORK
    
    all_risks = []
    for pillar, risks in HEXAGON_FRAMEWORK.items():
        for risk in risks:
            all_risks.append({
                "risk_id": risk.id,
                "risk_name": risk.name,
                "pillar": pillar,
                "severity": risk.severity.value if hasattr(risk.severity, 'value') else str(risk.severity),
                "description": risk.description,
                "recommendation": risk.recommendation,
            })
    
    return {"risks": all_risks, "total": len(all_risks)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
