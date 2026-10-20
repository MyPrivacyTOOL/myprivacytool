"""Scoring engine. Fixes MPC-7877 issue 1: the old `int(raw*100) % 100` wrapped
around and never reproduced the design example (Risk #57 -> ~26)."""
from typing import Dict, List, Sequence, Tuple

from app.models import HEXAGON_RISKS, PILLARS, PillarScore, RiskDetection, Severity

CONFIDENCE_REGEX = 0.95
# Half-saturation constant, calibrated so the design example
# (2 hits, 24h, baseline 45) scores ~26. Assumption: revisit with real data.
HALF_SATURATION = 0.04
SEVERITY_WEIGHT = {"CRITICAL": 3, "HIGH": 2, "MEDIUM": 1, "LOW": 0.5}


def recency_penalty(age_hours: float) -> float:
    if age_hours <= 24:
        return 1.0
    if age_hours <= 24 * 7:
        return 0.7
    return 0.3


def risk_score(frequency: int, baseline: int, age_hours: float = 0.0,
               exposure_days: float = 1.0, confidence: float = CONFIDENCE_REGEX) -> int:
    """Saturating score in [0, baseline]: monotone in frequency, never wraps."""
    exposure = min(max(exposure_days, 0.0) / 7.0, 1.0)
    raw = (max(frequency, 0) * recency_penalty(age_hours) * exposure * confidence) / 5
    return round(baseline * raw / (raw + HALF_SATURATION))


def pillar_score(pillar: str, detections: List[RiskDetection], incomplete: bool = False) -> PillarScore:
    """Weighted mean of risk scores, expressed as a 0-100 *safety* score
    (100 - weighted risk). An incomplete audit is never reported as safe."""
    items = [d for d in detections if d.pillar == pillar]
    if not items:
        return PillarScore(pillar, 90, Severity.LOW, 0, incomplete)
    total = weighted = 0.0
    for d in items:
        w = SEVERITY_WEIGHT[d.severity.value] * min(d.frequency, 5)
        baseline = HEXAGON_RISKS.get(d.risk_id, {}).get("baseline_score", 50)
        total += w
        weighted += risk_score(d.frequency, baseline) * w
    score = max(0, min(100, round(100 - weighted / total)))
    level = Severity.LOW if score >= 80 else Severity.MEDIUM if score >= 65 else Severity.HIGH
    return PillarScore(pillar, score, level, len(items), incomplete)


QUARANTINE_SEVERITIES = {"CRITICAL", "HIGH"}


def overall(pillars: Dict[str, PillarScore], audit_complete: bool,
            detections: Sequence[RiskDetection] = ()) -> Tuple[int, str]:
    """Incomplete audits (a detector errored) can never be APPROVED. Any HIGH or
    CRITICAL detection forces QUARANTINE whatever the averaged score is (owner
    decision, MPC-7877): an averaged score must not hide a serious finding."""
    score = round(sum(p.score for p in pillars.values()) / len(pillars)) if pillars else 0
    if not audit_complete:
        return score, "INCOMPLETE"
    if any(d.severity.value in QUARANTINE_SEVERITIES for d in detections):
        return score, "QUARANTINE"
    return score, "APPROVED_FOR_P1_DATA" if score >= 50 else "QUARANTINE"


def score_all(detections: List[RiskDetection], audit_complete: bool) -> Tuple[Dict[str, PillarScore], int, str]:
    pillars = {p: pillar_score(p, detections, not audit_complete) for p in PILLARS}
    total, status = overall(pillars, audit_complete, detections)
    return pillars, total, status
