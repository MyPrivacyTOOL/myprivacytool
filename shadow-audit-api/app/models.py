"""Plain dataclass models (stdlib only) for detections and scores."""
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional


class Severity(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


PILLARS = (
    "contextWindow",
    "toolUseAndAPI",
    "interAgentCommunication",
    "modelAndInfrastructure",
    "complianceAndLegal",
)

# MVP subset of the Hexagon catalog (MPC-7855); remaining entries land in Phase 2.
HEXAGON_RISKS = {
    9: {"name": "Uncleared session context", "pillar": "contextWindow", "baseline_score": 70},
    41: {"name": "SQL injection risk", "pillar": "toolUseAndAPI", "baseline_score": 85},
    51: {"name": "DDoS via infinite loops", "pillar": "toolUseAndAPI", "baseline_score": 60},
    57: {"name": "API keys in logs", "pillar": "toolUseAndAPI", "baseline_score": 45},
}


@dataclass
class RiskDetection:
    risk_id: int
    risk_name: str
    pillar: str
    severity: Severity
    frequency: int
    evidence_excerpts: List[str] = field(default_factory=list)
    recommendation: str = ""


@dataclass
class DetectorError:
    """A detector that crashed. Never interpreted as 'no risk'."""
    detector: str
    error: str


@dataclass
class AuditOutcome:
    detections: List[RiskDetection]
    errors: List[DetectorError]

    @property
    def complete(self) -> bool:
        return not self.errors


@dataclass
class PillarScore:
    pillar: str
    score: int
    risk_level: Severity
    detected_risks: int
    incomplete: bool = False
    overall_note: Optional[str] = None
