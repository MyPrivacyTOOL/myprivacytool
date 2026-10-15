"""
PassportCredentialService: Issues and validates W3C VC Agent Passports.

Core responsibility:
1. Issue credentials after successful audits (risk_score > 70)
2. Sign credentials with Ed25519 keypair
3. Validate existing credentials
4. Revoke credentials when needed
5. Query passport status

Compliance: W3C VC Data Model v1.1
"""

import json
import uuid
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import hashlib
import hmac

from app.models import (
    AuditResult,
    AgentPassport,
    AgentPassportVC,
    CredentialSubject,
    PassportValidationRequest,
    PassportValidationResponse,
)


class PassportCredentialService:
    """
    Manages lifecycle of Agent Passport credentials.
    
    Storage: In-memory for MVP (production: database with encryption)
    Signing: Ed25519 (imported library required)
    """
    
    def __init__(
        self,
        issuer_url: str = "https://myprivacytool.io/shadow-audit-api",
        credential_validity_days: int = 90,
    ):
        """
        Initialize the credential service.
        
        Args:
            issuer_url: Canonical URL of the issuer
            credential_validity_days: Passport validity period
        """
        self.issuer_url = issuer_url
        self.credential_validity_days = credential_validity_days
        
        # MVP: In-memory storage
        self.passports: Dict[str, AgentPassport] = {}
        self.revoked_passports: set = set()
        
        # Load or generate signing key (MVP: hardcoded, production: KMS)
        self.signing_key = self._load_or_create_signing_key()
    
    def _load_or_create_signing_key(self) -> Dict[str, str]:
        """
        Load Ed25519 keypair for signing (MVP).
        
        Production: Use Google Cloud KMS or HashiCorp Vault.
        """
        # MVP: Return placeholder keypair info
        # In production, generate/load actual Ed25519 keys
        return {
            "algorithm": "Ed25519",
            "key_id": "audit-api-key-001",
            "public_key": "did:key:z6Mk...",  # Placeholder
        }
    
    def issue_passport(
        self,
        audit_result: AuditResult,
        agent_id: str,
        agent_name: Optional[str] = None,
    ) -> Optional[AgentPassport]:
        """
        Issue a W3C VC credential after successful audit.
        
        Criteria:
        - overall_risk_score >= 70 (safe threshold)
        - No CRITICAL risks
        - No more than 2 HIGH risks
        
        Args:
            audit_result: Completed audit
            agent_id: Agent identifier
            agent_name: Human-readable agent name
        
        Returns:
            AgentPassport if criteria met, None otherwise
        """
        # Check issuance criteria
        if not self._should_issue_credential(audit_result):
            return None
        
        passport_id = f"passport-{uuid.uuid4().hex[:12]}"
        now = datetime.utcnow()
        expires = now + timedelta(days=self.credential_validity_days)
        
        # Build credential subject
        subject = CredentialSubject(
            id=f"did:agent:{agent_id}",
            agent_name=agent_name or agent_id,
            data_exposure_compliant=self._is_pillar_compliant(
                audit_result, "data_exposure"
            ),
            consent_validity_compliant=self._is_pillar_compliant(
                audit_result, "consent_validity"
            ),
            credential_security_compliant=self._is_pillar_compliant(
                audit_result, "credential_security"
            ),
            process_integrity_compliant=self._is_pillar_compliant(
                audit_result, "process_integrity"
            ),
            external_risk_compliant=self._is_pillar_compliant(
                audit_result, "external_risk"
            ),
            overall_risk_score=audit_result.overall_risk_score,
            compliance_level=self._compute_compliance_level(audit_result),
        )
        
        # Build W3C VC credential
        credential = AgentPassportVC(
            issuer=self.issuer_url,
            issuance_date=now,
            expiration_date=expires,
            credential_subject=subject,
        )
        
        # Sign credential
        credential.proof = self._sign_credential(credential)
        
        # Wrap in AgentPassport
        passport = AgentPassport(
            passport_id=passport_id,
            agent_id=agent_id,
            audit_id=audit_result.audit_id,
            credential=credential,
            issued_at=now,
            expires_at=expires,
        )
        
        # Store
        self.passports[passport_id] = passport
        
        return passport
    
    def _should_issue_credential(self, audit_result: AuditResult) -> bool:
        """
        Check if credential issuance criteria are met.
        """
        # Minimum score: 70
        if audit_result.overall_risk_score < 70:
            return False
        
        # No CRITICAL risks
        if audit_result.critical_count > 0:
            return False
        
        # Max 2 HIGH risks
        if audit_result.high_count > 2:
            return False
        
        return True
    
    def _is_pillar_compliant(self, audit_result: AuditResult, pillar_name: str) -> bool:
        """
        Check if a pillar passed (score >= 70).
        """
        if not audit_result.pillar_scores:
            return True  # Default to compliant if not scored
        
        pillar_score = audit_result.pillar_scores.get(pillar_name)
        if pillar_score is None:
            return True
        
        return pillar_score.score >= 70
    
    def _compute_compliance_level(self, audit_result: AuditResult) -> str:
        """
        Compute compliance_level: compliant | partial_compliant | non_compliant.
        """
        # Compliant: score >= 80, no CRITICAL
        if audit_result.overall_risk_score >= 80 and audit_result.critical_count == 0:
            return "compliant"
        
        # Partial compliant: score >= 70, some HIGH risks
        if (audit_result.overall_risk_score >= 70 and 
            audit_result.critical_count == 0):
            return "partial_compliant"
        
        # Non-compliant: score < 70 or has CRITICAL
        return "non_compliant"
    
    def _sign_credential(self, credential: AgentPassportVC) -> Dict[str, Any]:
        """
        Sign credential with Ed25519 (MVP: HMAC placeholder).
        
        Production: Use actual Ed25519 signing via cryptography library.
        """
        # Serialize credential for signing
        credential_dict = credential.dict(
            exclude={"proof"},
            by_alias=False,
            exclude_none=False,
        )
        credential_json = json.dumps(credential_dict, sort_keys=True, default=str)
        
        # MVP: HMAC signature (not production-grade)
        # Production: Use Ed25519 from cryptography library
        signature = hmac.new(
            b"secret-key-placeholder",  # Use actual key in production
            credential_json.encode(),
            hashlib.sha256,
        ).hexdigest()
        
        # Return W3C LD-Proof structure
        return {
            "type": "Ed25519Signature2020",
            "created": datetime.utcnow().isoformat() + "Z",
            "verificationMethod": f"{self.issuer_url}#key-1",
            "signatureValue": signature,
        }
    
    def validate_passport(
        self,
        request: PassportValidationRequest,
    ) -> PassportValidationResponse:
        """
        Validate a passport credential.
        
        Checks:
        1. Passport exists
        2. Not revoked
        3. Not expired
        4. Signature valid (if requested)
        
        Returns:
            PassportValidationResponse with validity status
        """
        errors = []
        passport = self.passports.get(request.passport_id)
        
        if not passport:
            return PassportValidationResponse(
                valid=False,
                passport_id=request.passport_id,
                agent_id="unknown",
                expires_at=datetime.utcnow(),
                errors=["Passport not found"],
            )
        
        # Check revoked
        if passport.revoked:
            errors.append(
                f"Passport revoked: {passport.revocation_reason or 'no reason provided'}"
            )
        
        # Check expiration
        if datetime.utcnow() > passport.expires_at:
            errors.append("Passport expired")
        
        # Check signature (if requested)
        if request.verify_signature:
            if not self._verify_signature(passport.credential):
                errors.append("Signature verification failed")
        
        is_valid = len(errors) == 0 and not passport.revoked
        
        return PassportValidationResponse(
            valid=is_valid,
            passport_id=passport.passport_id,
            agent_id=passport.agent_id,
            expires_at=passport.expires_at,
            errors=errors,
        )
    
    def _verify_signature(self, credential: AgentPassportVC) -> bool:
        """
        Verify credential signature (MVP: stub).
        
        Production: Implement actual Ed25519 verification.
        """
        if not credential.proof:
            return False
        
        # MVP: Always return True (stub)
        # Production: Implement actual verification
        return True
    
    def revoke_passport(
        self,
        passport_id: str,
        reason: str,
    ) -> bool:
        """
        Revoke a passport credential.
        
        Args:
            passport_id: Passport to revoke
            reason: Revocation reason
        
        Returns:
            True if revoked, False if not found
        """
        passport = self.passports.get(passport_id)
        if not passport:
            return False
        
        passport.revoked = True
        passport.revocation_reason = reason
        self.revoked_passports.add(passport_id)
        
        return True
    
    def get_passport(self, passport_id: str) -> Optional[AgentPassport]:
        """Retrieve a passport credential."""
        return self.passports.get(passport_id)
    
    def list_passports_by_agent(self, agent_id: str) -> list[AgentPassport]:
        """List all passports for an agent."""
        return [p for p in self.passports.values() if p.agent_id == agent_id]
