"""
Hexagon Framework: 130-risk catalog for agent behavior auditing.
MVP: Top 10 critical risks across 5 pillars (data exposure, consent, credentials, process, external).

Each risk is defined as:
- risk_id: HX-{pillar_number}-{risk_number} format
- pillar: One of 5 audit pillars
- severity: critical | high | medium | low | info
- detection_method: How to detect this risk
- remediation: Recommended fix
"""

from typing import Dict, List
from app.models import AuditPillar, RiskLevel


# MVP Risk Catalog (Top 10)
HEXAGON_RISKS: Dict[str, Dict] = {
    # Pillar 1: Data Exposure (risks 01-02)
    "HX-1-01": {
        "risk_id": "HX-1-01",
        "risk_name": "PII Exposure in Logs/Context",
        "pillar": AuditPillar.DATA_EXPOSURE,
        "severity": RiskLevel.CRITICAL,
        "description": "Agent's system context or logged outputs contain unencrypted personally identifiable information (email, phone, address, SSN, etc.) where users/external systems could read it.",
        "recommendation": "Redact PII from all logs and context using field-level masking. Store PII in encrypted, access-controlled storage only.",
        "detection_method": "Scan system context and recent log entries for PII patterns (email regex, phone patterns, SSN format, known PII fields).",
    },
    "HX-1-02": {
        "risk_id": "HX-1-02",
        "risk_name": "Credential Exposure in Logs/Responses",
        "pillar": AuditPillar.DATA_EXPOSURE,
        "severity": RiskLevel.CRITICAL,
        "description": "API keys, tokens, passwords, or other credentials are visible in logs, error messages, or response bodies.",
        "recommendation": "Never log credentials. Use Secret Manager. Mask credentials in error messages. Rotate exposed credentials immediately.",
        "detection_method": "Scan logs and responses for patterns matching API keys, Bearer tokens, passwords, secret manager URIs.",
    },
    
    # Pillar 2: Consent Validity (risks 03-04)
    "HX-2-01": {
        "risk_id": "HX-2-01",
        "risk_name": "Undefined User Consent Scope",
        "pillar": AuditPillar.CONSENT_VALIDITY,
        "severity": RiskLevel.HIGH,
        "description": "Agent is operating on user data without explicit, documented user consent for the specific action (e.g., writing to third-party databases, calling external APIs).",
        "recommendation": "Document consent UI and approval flow. Require user explicit opt-in before any external data transfer. Log consent events.",
        "detection_method": "Check for consent validator module. Verify consent log entries exist for recent external API calls.",
    },
    "HX-2-02": {
        "risk_id": "HX-2-02",
        "risk_name": "Consent Expiration Not Enforced",
        "pillar": AuditPillar.CONSENT_VALIDITY,
        "severity": RiskLevel.HIGH,
        "description": "User consent is not validated to be current (e.g., consent expired, user revoked, consent scope changed).",
        "recommendation": "Implement consent expiration (default 30 days). Check freshness before every external action. Revocation API with immediate effect.",
        "detection_method": "Inspect consent validation logic. Check if freshness checks are performed before external calls.",
    },
    
    # Pillar 3: Credential Security (risks 05-06)
    "HX-3-01": {
        "risk_id": "HX-3-01",
        "risk_name": "Hardcoded or Plaintext Secrets",
        "pillar": AuditPillar.CREDENTIAL_SECURITY,
        "severity": RiskLevel.CRITICAL,
        "description": "Secrets (API keys, tokens, passwords) are hardcoded in source code, config files, or stored in plaintext.",
        "recommendation": "All secrets must come from Secret Manager or encrypted environment variables. Zero hardcoded secrets.",
        "detection_method": "Scan codebase and .env files for API key patterns, token strings, password variables.",
    },
    "HX-3-02": {
        "risk_id": "HX-3-02",
        "risk_name": "Credentials Not Rotated",
        "pillar": AuditPillar.CREDENTIAL_SECURITY,
        "severity": RiskLevel.HIGH,
        "description": "Long-lived credentials (API keys, service account keys) are not rotated regularly. Exposed credentials remain valid.",
        "recommendation": "Rotate all credentials every 90 days. Implement automated rotation. Monitor for credential age.",
        "detection_method": "Query Secret Manager for credential last-rotation timestamps. Flag any >90 days old.",
    },
    
    # Pillar 4: Process Integrity (risks 07-08)
    "HX-4-01": {
        "risk_id": "HX-4-01",
        "risk_name": "No Audit Trail for Data Access",
        "pillar": AuditPillar.PROCESS_INTEGRITY,
        "severity": RiskLevel.HIGH,
        "description": "Agent accesses user data (read/write) without logging who, when, and why. Audit trail is missing or incomplete.",
        "recommendation": "Log every data access: agent_id, timestamp, action (read/write), data_resource, user_id, justification.",
        "detection_method": "Verify audit logging is configured. Check for recent data access logs with proper fields.",
    },
    "HX-4-02": {
        "risk_id": "HX-4-02",
        "risk_name": "No Integrity Verification for Stored Data",
        "pillar": AuditPillar.PROCESS_INTEGRITY,
        "severity": RiskLevel.MEDIUM,
        "description": "Data stored by the agent (e.g., in databases, files) is not cryptographically signed/verified. Modifications could go undetected.",
        "recommendation": "Use cryptographic hashing (SHA-256) or signatures (Ed25519) to verify data integrity. Store hash alongside data.",
        "detection_method": "Check for HMAC or signature verification in data persistence layer.",
    },
    
    # Pillar 5: External Risk (risks 09-10)
    "HX-5-01": {
        "risk_id": "HX-5-01",
        "risk_name": "Unvalidated External Input Processing",
        "pillar": AuditPillar.EXTERNAL_RISK,
        "severity": RiskLevel.HIGH,
        "description": "Agent processes external input (from APIs, files, user submissions) without strict validation. Could lead to injection attacks or data corruption.",
        "recommendation": "Validate all external input against strict schemas. Reject unexpected formats. Use allowlists, not blocklists.",
        "detection_method": "Inspect input validation logic in API handlers and file processors. Check for schema validation before processing.",
    },
    "HX-5-02": {
        "risk_id": "HX-5-02",
        "risk_name": "Untrusted External API Dependencies",
        "pillar": AuditPillar.EXTERNAL_RISK,
        "severity": RiskLevel.MEDIUM,
        "description": "Agent depends on external third-party APIs without monitoring their integrity. API compromise or MitM attack could corrupt agent behavior.",
        "recommendation": "Pin API endpoint versions. Verify TLS certificates. Monitor API response signatures. Implement circuit breakers.",
        "detection_method": "List all external API calls. Check for TLS verification and response validation.",
    },
}


def get_risk(risk_id: str) -> Dict | None:
    """Retrieve a single risk definition by ID."""
    return HEXAGON_RISKS.get(risk_id)


def get_risks_by_pillar(pillar: AuditPillar) -> List[Dict]:
    """Get all risks in a specific pillar."""
    return [r for r in HEXAGON_RISKS.values() if r["pillar"] == pillar]


def get_risks_by_severity(severity: RiskLevel) -> List[Dict]:
    """Get all risks with a specific severity level."""
    return [r for r in HEXAGON_RISKS.values() if r["severity"] == severity]


def get_all_risks() -> List[Dict]:
    """Return all risks in the MVP catalog."""
    return list(HEXAGON_RISKS.values())
