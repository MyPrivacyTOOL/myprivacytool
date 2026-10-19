"""Shadow audit: compare what an agent was observed doing with what its passport declares."""
from datetime import datetime, timezone


def run_audit(passport, observed_scopes, observed_hosts, now=None) -> dict:
    now = now or datetime.now(timezone.utc)
    findings = []
    if passport is None:
        findings.append({"code": "NO_PASSPORT", "severity": "high"})
        verdict = "unregistered"
    else:
        if passport.status == "revoked":
            findings.append({"code": "PASSPORT_REVOKED", "severity": "high"})
        for s in sorted(set(observed_scopes) - set(passport.declared_scopes)):
            findings.append({"code": "UNDECLARED_SCOPE", "severity": "high", "value": s})
        for h in sorted(set(observed_hosts) - set(passport.declared_hosts)):
            findings.append({"code": "UNDECLARED_HOST", "severity": "medium", "value": h})
        verdict = "shadow_access" if findings else "clean"
    return {
        "verdict": verdict,
        "findings": findings,
        "observed": {"scopes": sorted(set(observed_scopes)), "hosts": sorted(set(observed_hosts))},
        "audited_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "disclaimer": "Attestation of observed state at audit time, not a guarantee of agent behaviour.",
    }
