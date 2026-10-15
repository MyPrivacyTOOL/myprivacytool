"""
RiskScorer: Core audit logic engine.
Detects risks from agent context, scores them by pillar, and aggregates to overall risk.
"""

import re
from typing import Dict, List, Optional
from app.models import (
    RiskDetection, RiskScore, RiskLevel, AuditPillar
)
from app.hexagon_framework import get_risk, get_all_risks


class RiskScorer:
    """
    Core risk detection and scoring engine.
    
    Responsibilities:
    1. Detect individual risks from agent context/logs
    2. Score each risk by severity and confidence
    3. Aggregate risks by pillar
    4. Calculate overall risk score
    """
    
    # Severity weight mapping (used in scoring calculation)
    SEVERITY_WEIGHTS = {
        RiskLevel.CRITICAL: 0.95,  # 95% penalty
        RiskLevel.HIGH: 0.70,      # 70% penalty
        RiskLevel.MEDIUM: 0.40,    # 40% penalty
        RiskLevel.LOW: 0.15,       # 15% penalty
        RiskLevel.INFO: 0.05,      # 5% penalty
    }
    
    # PII detection patterns
    PII_PATTERNS = {
        'email': re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'),
        'phone': re.compile(r'\+?1?\s*[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}'),
        'ssn': re.compile(r'\d{3}-\d{2}-\d{4}'),
        'credit_card': re.compile(r'\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b'),
        'address': re.compile(r'\d+\s+[A-Za-z]+\s+(Street|Avenue|Road|Boulevard|Drive|Lane|Circle|Court)'),
    }
    
    # Credential detection patterns
    CREDENTIAL_PATTERNS = {
        'api_key': re.compile(r'sk_live_[a-zA-Z0-9]{20,}|sk_test_[a-zA-Z0-9]{20,}'),
        'bearer_token': re.compile(r'Bearer\s+[a-zA-Z0-9\-_\.]+'),
        'jwt': re.compile(r'eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.'),
        'password': re.compile(r'(password|passwd|pwd)\s*[=:]\s*[^\s]+'),
        'secret_uri': re.compile(r'secret[s]?://[^\s]+'),
    }
    
    def detect_pii_exposure(self, context: str) -> Optional[RiskDetection]:
        """
        Scan context for PII patterns.
        Returns RiskDetection if any PII found, None otherwise.
        """
        if not context:
            return None
        
        for pii_type, pattern in self.PII_PATTERNS.items():
            if pattern.search(context):
                return RiskDetection(
                    risk_id="HX-1-01",
                    risk_name="PII Exposure in Logs/Context",
                    pillar=AuditPillar.DATA_EXPOSURE,
                    severity=RiskLevel.CRITICAL,
                    description=f"Detected {pii_type} in context: {pii_type.upper()} pattern found.",
                    recommendation="Redact PII from all logs and context using field-level masking.",
                    confidence=0.98
                )
        
        return None
    
    def detect_credential_exposure(self, content: str) -> Optional[RiskDetection]:
        """
        Scan content (logs, responses, context) for exposed credentials.
        Returns RiskDetection if any credentials found, None otherwise.
        """
        if not content:
            return None
        
        for cred_type, pattern in self.CREDENTIAL_PATTERNS.items():
            if pattern.search(content):
                return RiskDetection(
                    risk_id="HX-1-02",
                    risk_name="Credential Exposure in Logs/Responses",
                    pillar=AuditPillar.DATA_EXPOSURE,
                    severity=RiskLevel.CRITICAL,
                    description=f"Detected {cred_type} in content: {cred_type.upper()} pattern found.",
                    recommendation="Never log credentials. Use Secret Manager. Rotate exposed credentials immediately.",
                    confidence=0.99
                )
        
        return None
    
    def detect_consent_issues(self, consent_log: Dict) -> Optional[RiskDetection]:
        """
        Detect consent-related issues.
        - Missing consent validator
        - Expired or invalid consent
        - Missing scope documentation
        """
        if not consent_log:
            return RiskDetection(
                risk_id="HX-2-01",
                risk_name="Undefined User Consent Scope",
                pillar=AuditPillar.CONSENT_VALIDITY,
                severity=RiskLevel.HIGH,
                description="No consent log found. Consent scope is undefined.",
                recommendation="Document consent UI and approval flow. Require explicit opt-in.",
                confidence=1.0
            )
        
        # Check if consent is expired
        consent_age_days = consent_log.get('age_days', 999)
        if consent_age_days > 30:
            return RiskDetection(
                risk_id="HX-2-02",
                risk_name="Consent Expiration Not Enforced",
                pillar=AuditPillar.CONSENT_VALIDITY,
                severity=RiskLevel.HIGH,
                description=f"Consent is {consent_age_days} days old (expires at 30 days).",
                recommendation="Implement consent expiration. Check freshness before external actions.",
                confidence=0.95
            )
        
        return None
    
    def detect_credential_security_issues(self, env_config: Dict) -> Optional[RiskDetection]:
        """
        Detect credential security issues.
        - Hardcoded secrets
        - Unrotated credentials (>90 days old)
        """
        if not env_config:
            return None
        
        # Check for hardcoded secrets (simplified check)
        for key, value in env_config.items():
            if isinstance(value, str):
                # Heuristic: secrets shouldn't be short hardcoded strings
                if any(keyword in key.lower() for keyword in ['secret', 'token', 'key', 'api']):
                    if len(value) < 20 or value.startswith('hardcoded'):
                        return RiskDetection(
                            risk_id="HX-3-01",
                            risk_name="Hardcoded or Plaintext Secrets",
                            pillar=AuditPillar.CREDENTIAL_SECURITY,
                            severity=RiskLevel.CRITICAL,
                            description=f"Potential hardcoded secret in {key}.",
                            recommendation="All secrets must come from Secret Manager.",
                            confidence=0.70
                        )
        
        # Check for unrotated credentials
        last_rotation = env_config.get('last_rotation_date')
        if last_rotation:
            from datetime import datetime, timedelta
            days_since_rotation = (datetime.utcnow() - last_rotation).days
            if days_since_rotation > 90:
                return RiskDetection(
                    risk_id="HX-3-02",
                    risk_name="Credentials Not Rotated",
                    pillar=AuditPillar.CREDENTIAL_SECURITY,
                    severity=RiskLevel.HIGH,
                    description=f"Credentials last rotated {days_since_rotation} days ago.",
                    recommendation="Rotate all credentials every 90 days. Implement automated rotation.",
                    confidence=1.0
                )
        
        return None
    
    def detect_audit_trail_issues(self, audit_config: Dict) -> Optional[RiskDetection]:
        """
        Detect process integrity issues.
        - Missing audit trail
        - No data access logging
        """
        if not audit_config:
            return RiskDetection(
                risk_id="HX-4-01",
                risk_name="No Audit Trail for Data Access",
                pillar=AuditPillar.PROCESS_INTEGRITY,
                severity=RiskLevel.HIGH,
                description="No audit trail configured. Data access logging is missing.",
                recommendation="Log every data access: agent_id, timestamp, action, resource, user_id.",
                confidence=1.0
            )
        
        # Check if audit logging has required fields
        required_fields = {'agent_id', 'timestamp', 'action', 'resource'}
        if not required_fields.issubset(audit_config.get('logged_fields', set())):
            return RiskDetection(
                risk_id="HX-4-01",
                risk_name="No Audit Trail for Data Access",
                pillar=AuditPillar.PROCESS_INTEGRITY,
                severity=RiskLevel.HIGH,
                description="Audit trail exists but is missing required fields.",
                recommendation="Ensure logging includes: agent_id, timestamp, action, resource.",
                confidence=0.85
            )
        
        return None
    
    def detect_input_validation_issues(self, validation_config: Dict) -> Optional[RiskDetection]:
        """
        Detect external risk issues.
        - Unvalidated external input
        - Missing schema validation
        """
        if not validation_config:
            return RiskDetection(
                risk_id="HX-5-01",
                risk_name="Unvalidated External Input Processing",
                pillar=AuditPillar.EXTERNAL_RISK,
                severity=RiskLevel.HIGH,
                description="No input validation configured.",
                recommendation="Validate all external input against strict schemas. Use allowlists.",
                confidence=1.0
            )
        
        # Check if schema validation is enabled
        if not validation_config.get('schema_validation_enabled', False):
            return RiskDetection(
                risk_id="HX-5-01",
                risk_name="Unvalidated External Input Processing",
                pillar=AuditPillar.EXTERNAL_RISK,
                severity=RiskLevel.HIGH,
                description="Schema validation is disabled.",
                recommendation="Enable strict schema validation for all external input.",
                confidence=0.90
            )
        
        return None
    
    def calculate_pillar_score(
        self,
        pillar: AuditPillar,
        detected_risks: List[RiskDetection]
    ) -> RiskScore:
        """
        Calculate risk score for a single pillar.
        
        Scoring logic:
        - Start with 100 (perfect)
        - For each risk: deduct (severity_weight * confidence * 100)
        - Min score: 0, Max score: 100
        """
        if not detected_risks:
            return RiskScore(
                pillar=pillar,
                score=100,
                detected_risks=[],
                remediation_priority=5  # No priority if no risks
            )
        
        total_penalty = 0.0
        for risk in detected_risks:
            severity_weight = self.SEVERITY_WEIGHTS.get(risk.severity, 0.5)
            risk_penalty = severity_weight * risk.confidence * 100
            total_penalty += risk_penalty
        
        # Cap at 0 (minimum score)
        final_score = max(0, 100 - total_penalty)
        
        # Determine remediation priority (1=highest, 5=lowest)
        critical_count = sum(1 for r in detected_risks if r.severity == RiskLevel.CRITICAL)
        if critical_count > 0:
            priority = 1
        elif any(r.severity == RiskLevel.HIGH for r in detected_risks):
            priority = 2
        elif any(r.severity == RiskLevel.MEDIUM for r in detected_risks):
            priority = 3
        else:
            priority = 4
        
        return RiskScore(
            pillar=pillar,
            score=final_score,
            detected_risks=detected_risks,
            remediation_priority=priority
        )
    
    def aggregate_pillar_scores(self, pillar_scores: Dict[str, RiskScore]) -> int:
        """
        Aggregate 5 pillar scores into a single overall risk score.
        
        Weighting:
        - Data Exposure: 25% (highest weight — data is the core asset)
        - Credential Security: 25% (highest weight — credentials = access)
        - Consent Validity: 20% (regulatory risk)
        - Process Integrity: 15% (operational risk)
        - External Risk: 15% (supply chain risk)
        """
        if not pillar_scores:
            return 100  # No risks = perfect score
        
        weights = {
            AuditPillar.DATA_EXPOSURE.value: 0.25,
            AuditPillar.CREDENTIAL_SECURITY.value: 0.25,
            AuditPillar.CONSENT_VALIDITY.value: 0.20,
            AuditPillar.PROCESS_INTEGRITY.value: 0.15,
            AuditPillar.EXTERNAL_RISK.value: 0.15,
        }
        
        weighted_sum = 0.0
        for pillar_key, weight in weights.items():
            score_obj = pillar_scores.get(pillar_key)
            if score_obj:
                weighted_sum += score_obj.score * weight
        
        return int(round(weighted_sum))
    
    def run_full_audit(self, agent_context: Dict) -> Dict:
        """
        Run a complete audit on agent context.
        
        Returns a dict with:
        - pillar_scores: {pillar -> RiskScore}
        - overall_risk_score: int (0-100)
        - all_detected_risks: list of RiskDetection
        """
        all_risks = []
        pillar_scores = {}
        
        # Detect risks across all pillars
        
        # DATA_EXPOSURE
        pii_risk = self.detect_pii_exposure(agent_context.get('system_context', ''))
        if pii_risk:
            all_risks.append(pii_risk)
        
        cred_risk = self.detect_credential_exposure(
            agent_context.get('logs', '') + agent_context.get('context', '')
        )
        if cred_risk:
            all_risks.append(cred_risk)
        
        data_exposure_risks = [r for r in all_risks if r.pillar == AuditPillar.DATA_EXPOSURE]
        pillar_scores[AuditPillar.DATA_EXPOSURE.value] = self.calculate_pillar_score(
            AuditPillar.DATA_EXPOSURE,
            data_exposure_risks
        )
        
        # CONSENT_VALIDITY
        consent_risk = self.detect_consent_issues(agent_context.get('consent_log'))
        if consent_risk:
            all_risks.append(consent_risk)
        
        consent_risks = [r for r in all_risks if r.pillar == AuditPillar.CONSENT_VALIDITY]
        pillar_scores[AuditPillar.CONSENT_VALIDITY.value] = self.calculate_pillar_score(
            AuditPillar.CONSENT_VALIDITY,
            consent_risks
        )
        
        # CREDENTIAL_SECURITY
        cred_sec_risk = self.detect_credential_security_issues(agent_context.get('env_config'))
        if cred_sec_risk:
            all_risks.append(cred_sec_risk)
        
        cred_sec_risks = [r for r in all_risks if r.pillar == AuditPillar.CREDENTIAL_SECURITY]
        pillar_scores[AuditPillar.CREDENTIAL_SECURITY.value] = self.calculate_pillar_score(
            AuditPillar.CREDENTIAL_SECURITY,
            cred_sec_risks
        )
        
        # PROCESS_INTEGRITY
        audit_risk = self.detect_audit_trail_issues(agent_context.get('audit_config'))
        if audit_risk:
            all_risks.append(audit_risk)
        
        process_risks = [r for r in all_risks if r.pillar == AuditPillar.PROCESS_INTEGRITY]
        pillar_scores[AuditPillar.PROCESS_INTEGRITY.value] = self.calculate_pillar_score(
            AuditPillar.PROCESS_INTEGRITY,
            process_risks
        )
        
        # EXTERNAL_RISK
        input_risk = self.detect_input_validation_issues(agent_context.get('validation_config'))
        if input_risk:
            all_risks.append(input_risk)
        
        external_risks = [r for r in all_risks if r.pillar == AuditPillar.EXTERNAL_RISK]
        pillar_scores[AuditPillar.EXTERNAL_RISK.value] = self.calculate_pillar_score(
            AuditPillar.EXTERNAL_RISK,
            external_risks
        )
        
        # Aggregate to overall score
        overall_score = self.aggregate_pillar_scores(pillar_scores)
        
        return {
            'pillar_scores': pillar_scores,
            'overall_risk_score': overall_score,
            'all_detected_risks': all_risks,
            'total_risks': len(all_risks),
            'critical_count': sum(1 for r in all_risks if r.severity == RiskLevel.CRITICAL),
            'high_count': sum(1 for r in all_risks if r.severity == RiskLevel.HIGH),
        }
