"""
FastAPI application for Agent Shadow Audit API v1.

Endpoints:
- POST /api/v1/audit/run — Run full audit on agent context
- GET /api/v1/audit/{audit_id} — Retrieve audit result
- POST /api/v1/passport/issue — Issue Agent Passport credential (W3C VC)
- GET /api/v1/passport/{passport_id} — Retrieve credential
- POST /api/v1/passport/validate — Validate credential
- POST /api/v1/passport/revoke — Revoke credential
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from datetime import datetime, timedelta
from typing import Dict, Optional
import uuid

from app.scorer import RiskScorer
from app.services.passport_service import PassportCredentialService
from app.models import (
    AuditRequest,
    AuditResult,
    AgentPassport,
    PassportValidationRequest,
    PassportValidationResponse,
    RiskLevel,
)

app = FastAPI(
    title="Agent Shadow Audit API",
    description="Non-invasive audit service for agent risk assessment and W3C VC credential issuance",
    version="1.0.0",
)

# In-memory store for audit results (dev only — replace with DB in production)
audit_results_store: Dict[str, AuditResult] = {}

# Initialize services
scorer = RiskScorer()
passport_service = PassportCredentialService(
    issuer_url="https://myprivacytool.io/shadow-audit-api",
    credential_validity_days=90,
)


# ============================================================================
# HEALTH & INFO ENDPOINTS
# ============================================================================

@app.get("/health")
def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "shadow-audit-api-v1",
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.get("/api/v1/hexagon/risks")
def list_all_risks():
    """
    List all risks in the Hexagon Framework (130 total).
    """
    from app.hexagon_framework import HEXAGON_FRAMEWORK

    all_risks = []
    for pillar, risks in HEXAGON_FRAMEWORK.items():
        for risk in risks:
            all_risks.append(
                {
                    "risk_id": risk.id,
                    "risk_name": risk.name,
                    "pillar": pillar,
                    "severity": (
                        risk.severity.value
                        if hasattr(risk.severity, "value")
                        else str(risk.severity)
                    ),
                    "description": risk.description,
                    "recommendation": risk.recommendation,
                }
            )

    return {"risks": all_risks, "total": len(all_risks)}


# ============================================================================
# AUDIT ENDPOINTS
# ============================================================================

@app.post("/api/v1/audit/run")
def run_audit(request: AuditRequest) -> AuditResult:
    """
    Run a full audit on agent context.

    Input:
    - agent_id: str — agent to audit
    - context: Dict — agent context (logs, environment, consent, config)
    - pillar: Optional[AuditPillar] — if specified, audit only that pillar
    - issue_passport: bool — auto-issue passport if audit passes

    Output:
    - AuditResult with overall_risk_score (0-100) and pillar breakdown
    """
    try:
        # Generate audit ID
        audit_id = f"audit-{uuid.uuid4().hex[:12]}"

        # Run the audit
        audit_output = scorer.run_full_audit(
            request.context,
            pillar=request.pillar,
        )

        # Build AuditResult
        result = AuditResult(
            audit_id=audit_id,
            agent_id=request.agent_id,
            overall_risk_score=audit_output["overall_risk_score"],
            total_risks_detected=audit_output["total_risks"],
            critical_count=audit_output["critical_count"],
            high_count=audit_output["high_count"],
            pillar_scores=audit_output["pillar_scores"],
            detected_risks=audit_output["all_detected_risks"],
            timestamp=datetime.utcnow(),
        )

        # Store result (dev: in-memory; prod: database)
        audit_results_store[audit_id] = result

        # Auto-issue passport if requested
        if request.issue_passport:
            passport = passport_service.issue_passport(result, request.agent_id)
            if passport:
                result.passport = passport  # Attach to audit result for response

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


# ============================================================================
# PASSPORT ENDPOINTS (W3C VC)
# ============================================================================

@app.post("/api/v1/passport/issue")
def issue_passport(audit_id: str, agent_id: str, agent_name: Optional[str] = None):
    """
    Issue an Agent Passport credential based on audit results.

    This endpoint issues a W3C Verifiable Credential (VC) that proves
    the agent passed the Hexagon Framework audit.

    Input:
    - audit_id: str — the audit to base the passport on
    - agent_id: str — agent identifier
    - agent_name: Optional[str] — human-readable name

    Output:
    - AgentPassport with W3C VC-compatible claims
    """
    # Fetch audit result
    audit_result = audit_results_store.get(audit_id)
    if not audit_result:
        raise HTTPException(status_code=404, detail=f"Audit {audit_id} not found")

    # Issue passport
    passport = passport_service.issue_passport(
        audit_result,
        agent_id=agent_id,
        agent_name=agent_name,
    )

    if not passport:
        raise HTTPException(
            status_code=400,
            detail="Audit did not meet credential issuance criteria (risk score < 70 or contains CRITICAL risks)",
        )

    return passport


@app.get("/api/v1/passport/{passport_id}")
def get_passport(passport_id: str) -> AgentPassport:
    """
    Retrieve a passport credential by ID.
    """
    passport = passport_service.get_passport(passport_id)
    if not passport:
        raise HTTPException(status_code=404, detail=f"Passport {passport_id} not found")

    return passport


@app.post("/api/v1/passport/validate")
def validate_passport(request: PassportValidationRequest) -> PassportValidationResponse:
    """
    Validate a passport credential.

    Checks:
    1. Passport exists
    2. Not revoked
    3. Not expired
    4. Signature valid (if requested)

    Input:
    - passport_id: str
    - verify_signature: bool — verify Ed25519 signature (default: True)

    Output:
    - PassportValidationResponse with validity status
    """
    return passport_service.validate_passport(request)


@app.post("/api/v1/passport/revoke")
def revoke_passport(passport_id: str, reason: str):
    """
    Revoke a passport credential.

    Input:
    - passport_id: str
    - reason: str — revocation reason

    Output:
    - {"revoked": bool, "passport_id": str}
    """
    success = passport_service.revoke_passport(passport_id, reason)

    if not success:
        raise HTTPException(status_code=404, detail=f"Passport {passport_id} not found")

    return {
        "revoked": True,
        "passport_id": passport_id,
        "reason": reason,
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.get("/api/v1/passport/agent/{agent_id}")
def list_agent_passports(agent_id: str):
    """
    List all passports issued for an agent.

    Input:
    - agent_id: str

    Output:
    - {"passports": [AgentPassport, ...], "total": int}
    """
    passports = passport_service.list_passports_by_agent(agent_id)

    return {
        "agent_id": agent_id,
        "passports": passports,
        "total": len(passports),
    }


# ============================================================================
# STARTUP / SHUTDOWN
# ============================================================================

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup."""
    print("✓ Shadow Audit API v1 started")
    print(f"✓ Hexagon Framework: 130 risks across 5 pillars")
    print(f"✓ Passport Service: W3C VC issuer ready")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
