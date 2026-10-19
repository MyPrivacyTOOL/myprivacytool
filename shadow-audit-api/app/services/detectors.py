"""MVP detectors. Each takes LogEntry-like dicts and returns RiskDetection or None.
Entries: {"ts": iso, "text": str, "tool": str|None, "session": str|None, "vault_start": [keys], "vault_end": [keys]}"""
import re
from typing import Dict, List, Optional

from app.models import HEXAGON_RISKS, RiskDetection, Severity

Entries = List[Dict]
CRED_RE = re.compile(r"(sk_live_|pk_live_|AKIA[0-9A-Z]{12,}|Bearer\s+[A-Za-z0-9_\-]{40,}|password\s*[:=]\s*\S+)")
SQLI_RE = re.compile(r"(?i)(select|insert|update|delete)\b[^\n]*(['\"]\s*\+|\+\s*['\"]|%s.*%\s*\w+|f['\"].*\{)")


def _mk(rid: int, sev: Severity, freq: int, ev: List[str], rec: str) -> RiskDetection:
    r = HEXAGON_RISKS[rid]
    return RiskDetection(rid, r["name"], r["pillar"], sev, freq, ev[:3], rec)


def detect_57_api_keys(entries: Entries) -> Optional[RiskDetection]:
    hits = [e for e in entries if CRED_RE.search(e.get("text", ""))]
    if not hits:
        return None
    # Evidence never includes the matched secret itself.
    ev = [f"Credential pattern at {e.get('ts')}" for e in hits]
    return _mk(57, Severity.HIGH, len(hits), ev, "Enable log redaction middleware")


def detect_9_uncleared_context(entries: Entries, threshold: int = 3) -> Optional[RiskDetection]:
    by_session = [e for e in entries if e.get("session")]
    by_session.sort(key=lambda e: e["ts"])
    bad, ev = 0, []
    for a, b in zip(by_session, by_session[1:]):
        residual = set(a.get("vault_end", [])) & set(b.get("vault_start", []))
        if len(residual) > threshold:
            bad += 1
            ev.append(f"{a['session']} -> {b['session']}: {len(residual)} keys residual")
    if not bad:
        return None
    return _mk(9, Severity.HIGH if bad > 3 else Severity.MEDIUM, bad, ev, "Clear vault on task completion")


def detect_41_sql_injection(entries: Entries) -> Optional[RiskDetection]:
    hits = [e for e in entries if SQLI_RE.search(e.get("text", ""))]
    if not hits:
        return None
    return _mk(41, Severity.CRITICAL, len(hits), [f"String-built SQL at {e.get('ts')}" for e in hits],
               "Use parameterised queries")


def detect_51_tool_loops(entries: Entries, run: int = 20) -> Optional[RiskDetection]:
    loops, streak, prev, ev = 0, 0, None, []
    for e in sorted((x for x in entries if x.get("tool")), key=lambda x: x["ts"]):
        key = (e["tool"], e.get("text"))
        streak = streak + 1 if key == prev else 1
        if streak == run:
            loops += 1
            ev.append(f"{e['tool']} repeated {run}+ times from {e['ts']}")
        prev = key
    if not loops:
        return None
    return _mk(51, Severity.HIGH, loops, ev, "Add exit condition / call budget")


ALL = [("risk57", detect_57_api_keys), ("risk9", detect_9_uncleared_context),
       ("risk41", detect_41_sql_injection), ("risk51", detect_51_tool_loops)]
