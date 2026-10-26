"""Orchestrates one audit: fetch logs -> detect -> score -> sign -> persist -> notify."""
import itertools
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from app.config import Settings
from app.crypto import signing
from app.models import HEXAGON_RISKS
from app.services import detectors, risk_detector, scorer

log = logging.getLogger("shadow_audit.audit")
_seq = itertools.count(1)


class AuditService:
    def __init__(self, settings: Settings, source, signer: Optional[signing.PassportSigner],
                 notion=None, slack=None):
        self.s, self.source, self.signer, self.notion, self.slack = settings, source, signer, notion, slack
        self.audits: Dict[str, Dict] = {}

    def run(self, agent_id: str, lookback_days: Optional[int] = None) -> Dict:
        now = datetime.now(timezone.utc)
        days = lookback_days or self.s.lookback_days
        errors: List[str] = []
        cov: Dict[str, bool] = {}
        try:
            entries = self.source.fetch(agent_id, days)
            if not entries:
                # No evidence is not evidence of safety: unknown agent, wrong id or empty window.
                raise LookupError(f"no log entries for agent '{agent_id}' in the last {days} days")
            cov = detectors.coverage(entries)
            outcome = risk_detector.run_audit([(n, (lambda f=f: f(entries))) for n, f in detectors.build(self.s)])
        except Exception as exc:  # noqa: BLE001 - log source failure => incomplete audit
            log.exception("log source failed for %s", agent_id)
            outcome = risk_detector.AuditOutcome([], [risk_detector.DetectorError("log_source", str(exc))])
        errors = [f"{e.detector}: {e.error}" for e in outcome.errors]
        covered = sum(cov.values())
        pillars, total, status = scorer.score_all(outcome.detections, outcome.complete, covered, self.s.min_coverage)
        no_score = status in ("INCOMPLETE", "INSUFFICIENT_DATA")
        iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        exp = (now + timedelta(days=365)).strftime("%Y-%m-%dT%H:%M:%SZ")
        audit_id = f"audit-{now:%Y-%m-%d}-{next(_seq):05d}"
        passport = None
        if self.signer and not no_score:   # no passport when we could not look, or barely could
            doc = signing.build_passport(agent_id, total, status, iso, exp, self.s.environment,
                                         {"checked": covered, "of": len(cov)})
            passport = self.signer.sign(doc, iso)
        result = {
            "auditId": audit_id, "agentId": agent_id, "auditDate": iso, "environment": self.s.environment,
            "status": "completed" if outcome.complete else "incomplete",
            # An incomplete audit has no trustworthy score; never show 90 for "we could not look".
            "overallScore": None if no_score else total,
            "coverage": {"checked": covered, "of": len(cov), "minimum": self.s.min_coverage,
                         "detectors": cov},
            "riskLevel": status, "errors": errors,
            "pillars": {k: {"score": v.score, "riskLevel": v.risk_level.value} for k, v in pillars.items()},
            "detectedRisks": [{"riskId": d.risk_id, "riskName": d.risk_name, "severity": d.severity.value,
                               "frequency": d.frequency, "evidenceExcerpts": d.evidence_excerpts,
                               "recommendation": d.recommendation} for d in outcome.detections],
            "passportIssued": passport is not None, "remediation": {},
        }
        if passport:
            result["passport"] = passport
        self.audits[audit_id] = result
        self._publish(result, passport, exp)
        return result

    def _publish(self, r: Dict, passport, exp: str) -> None:
        # Outbound failures must not lose the audit result; record them on the result.
        if self.notion and passport:
            try:
                r["passportUrl"] = self.notion.write_passport({
                    "agent_id": r["agentId"], "audit_id": r["auditId"], "environment": r["environment"],
                    "status": r["riskLevel"], "overall_score": r["overallScore"], "complete": True,
                    "issued": r["auditDate"], "expires": exp, "passport": passport,
                    "risk_summary": "; ".join(f"#{d['riskId']} {d['riskName']} x{d['frequency']}"
                                              for d in r["detectedRisks"]) or "none"})
            except Exception as exc:  # noqa: BLE001
                log.exception("notion write failed")
                r["errors"].append(f"notion: {exc}")
        # Alert only on results that need a human (QUARANTINE, INCOMPLETE), not on every clean audit.
        if self.slack and r["riskLevel"] != "APPROVED_FOR_P1_DATA":
            try:
                self.slack.notify(f"[{r['environment']}] Shadow audit {r['auditId']} for {r['agentId']}: "
                                  f"{r['riskLevel']} ({r['overallScore'] if r['overallScore'] is not None else 'no score'}), {len(r['detectedRisks'])} risks")
            except Exception as exc:  # noqa: BLE001
                log.exception("slack notify failed")
                r["errors"].append(f"slack: {exc}")

    def history(self, agent_id: str, limit: int = 10) -> List[Dict]:
        rows = [a for a in self.audits.values() if a["agentId"] == agent_id]
        return sorted(rows, key=lambda a: a["auditId"], reverse=True)[:limit]

    def remediate(self, audit_id: str, remediation_id: str, status: str) -> bool:
        if status not in ("in_progress", "completed", "rejected") or audit_id not in self.audits:
            return False
        self.audits[audit_id]["remediation"][remediation_id] = status
        return True
