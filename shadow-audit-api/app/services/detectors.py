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


ERROR_RE = re.compile(r"(Traceback \(most recent|\bException\b|\bERROR\b|\bstack trace\b)")


def _is_error_trace(e: Dict) -> bool:
    return bool(ERROR_RE.search(e.get("text", "")))


def detect_57_api_keys(entries: Entries) -> Optional[RiskDetection]:
    # Error/stack-trace entries are reported under #58 instead, so one leak isn't counted twice.
    hits = [e for e in entries if CRED_RE.search(e.get("text", "")) and not _is_error_trace(e)]
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


INJECTION_RE = re.compile(
    r"(?i)(ignore|disregard|forget)\s+(all\s+|any\s+|the\s+|your\s+)?(previous|prior|above|earlier)\s+(instructions|prompts?|rules)"
    r"|reveal\s+(your\s+|the\s+)?system\s+prompt|you\s+are\s+now\s+(DAN|in\s+developer\s+mode)")
SHELL_TOOLS = {"shell", "bash", "exec", "run_command", "terminal"}
SHELL_INJ_RE = re.compile(
    r"(;|&&|\|\|)\s*(rm|curl|wget|nc|ncat|bash|sh|chmod|chown|dd|python3?)\b|\$\(|`[^`]+`|\|\s*(sh|bash)\b")
PIP_RE = re.compile(r"\bpip3?\s+install\s+([^\n;&|]+)")
NPM_RE = re.compile(r"\bnpm\s+(?:install|i)\s+([^\n;&|]+)")


def detect_1_prompt_injection(entries: Entries) -> Optional[RiskDetection]:
    # Heuristic phrase match; flags attempts seen in logs, cannot prove they succeeded.
    hits = [e for e in entries if INJECTION_RE.search(e.get("text", ""))]
    if not hits:
        return None
    return _mk(1, Severity.HIGH, len(hits), [f"Injection phrase at {e.get('ts')}" for e in hits],
               "Isolate user input from system instructions; add input screening")


def detect_42_command_injection(entries: Entries) -> Optional[RiskDetection]:
    hits = [e for e in entries if e.get("tool") in SHELL_TOOLS and SHELL_INJ_RE.search(e.get("text", ""))]
    if not hits:
        return None
    return _mk(42, Severity.CRITICAL, len(hits),
               [f"Shell metacharacters in {e['tool']} call at {e.get('ts')}" for e in hits],
               "Pass arguments as an argv list, never via a shell string")


def detect_58_secrets_in_errors(entries: Entries) -> Optional[RiskDetection]:
    hits = [e for e in entries if _is_error_trace(e) and CRED_RE.search(e.get("text", ""))]
    if not hits:
        return None
    return _mk(58, Severity.HIGH, len(hits), [f"Credential in error output at {e.get('ts')}" for e in hits],
               "Scrub secrets from exceptions before logging or returning them")


def detect_65_replay(entries: Entries) -> Optional[RiskDetection]:
    seen, dupes, ev = set(), 0, []
    for e in sorted((x for x in entries if x.get("nonce")), key=lambda x: x["ts"]):
        key = (e.get("sender"), e["nonce"])
        if key in seen:
            dupes += 1
            ev.append(f"Nonce reused by {e.get('sender')} at {e['ts']}")
        seen.add(key)
    if not dupes:
        return None
    return _mk(65, Severity.HIGH, dupes, ev, "Reject reused nonces; add a timestamp window to A2A messages")


def _unpinned(cmd_re, text: str, pin_re) -> List[str]:
    bad = []
    for m in cmd_re.finditer(text):
        toks = m.group(1).split()
        if any(t in ("-r", "--requirement") for t in toks):
            continue  # requirements files are checked elsewhere
        bad += [t for t in toks if not t.startswith("-") and not pin_re.search(t)]
    return bad


def detect_99_unpinned_installs(entries: Entries) -> Optional[RiskDetection]:
    pip_pin, npm_pin = re.compile(r"(==|@|\.whl$|\.tar\.gz$)"), re.compile(r"[^/]@\d")
    hits = [e for e in entries if _unpinned(PIP_RE, e.get("text", ""), pip_pin)
            or _unpinned(NPM_RE, e.get("text", ""), npm_pin)]
    if not hits:
        return None
    return _mk(99, Severity.MEDIUM, len(hits), [f"Unpinned install at {e.get('ts')}" for e in hits],
               "Pin exact versions (pip pkg==x.y.z, npm pkg@x.y.z) and verify hashes")


def make_119(allowed_regions):
    allowed = {r.lower() for r in allowed_regions}

    def detect(entries: Entries) -> Optional[RiskDetection]:
        hits = [e for e in entries if e.get("dest_region") and e["dest_region"].lower() not in allowed]
        if not hits:
            return None
        return _mk(119, Severity.HIGH, len(hits),
                   [f"Data sent to region '{e['dest_region']}' at {e.get('ts')}" for e in hits],
                   "Block transfers outside allowed regions or add a transfer mechanism")
    return detect


def build(settings) -> list:
    """All detectors as (name, fn(entries))."""
    return [("risk1", detect_1_prompt_injection), ("risk9", detect_9_uncleared_context),
            ("risk41", detect_41_sql_injection), ("risk42", detect_42_command_injection),
            ("risk51", detect_51_tool_loops), ("risk57", detect_57_api_keys),
            ("risk58", detect_58_secrets_in_errors), ("risk65", detect_65_replay),
            ("risk99", detect_99_unpinned_installs), ("risk119", make_119(settings.allowed_regions))]
