"""Detector runner. Fixes MPC-7877 issue 2: failures were swallowed with
`pass` and read as 'no risk'. Now they are logged and mark the audit incomplete."""
import logging
from typing import Callable, List, Optional, Tuple

from app.models import AuditOutcome, DetectorError, RiskDetection

log = logging.getLogger("shadow_audit.detector")

Detector = Callable[[], Optional[RiskDetection]]


def run_audit(detectors: List[Tuple[str, Detector]]) -> AuditOutcome:
    detections: List[RiskDetection] = []
    errors: List[DetectorError] = []
    for name, fn in detectors:
        try:
            result = fn()
        except Exception as exc:  # noqa: BLE001 - any detector failure must be recorded
            log.exception("detector %s failed", name)
            errors.append(DetectorError(name, f"{type(exc).__name__}: {exc}"))
            continue
        if result is not None:
            detections.append(result)
    return AuditOutcome(detections, errors)
