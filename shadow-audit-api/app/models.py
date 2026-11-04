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
    1: {"name": "Direct prompt injection", "pillar": "contextWindow", "baseline_score": 75},
    9: {"name": "Uncleared session context", "pillar": "contextWindow", "baseline_score": 70},
    41: {"name": "SQL injection risk", "pillar": "toolUseAndAPI", "baseline_score": 85},
    51: {"name": "DDoS via infinite loops", "pillar": "toolUseAndAPI", "baseline_score": 60},
    42: {"name": "Command injection", "pillar": "toolUseAndAPI", "baseline_score": 85},
    57: {"name": "API keys in logs", "pillar": "toolUseAndAPI", "baseline_score": 45},
    58: {"name": "Secrets in error responses", "pillar": "toolUseAndAPI", "baseline_score": 55},
    65: {"name": "Replay attack", "pillar": "interAgentCommunication", "baseline_score": 65},
    99: {"name": "Version pinning bypass (unpinned installs)", "pillar": "modelAndInfrastructure", "baseline_score": 50},
    119: {"name": "Cross-border data transfer violation", "pillar": "complianceAndLegal", "baseline_score": 80},
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
