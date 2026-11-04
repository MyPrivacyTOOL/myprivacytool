"""Turn the OpenClaw router's audit trail (/opt/openclaw/audit/audit-*.jsonl) into rows for the
Shadow Audit API log table (BigQuery agent_logs.logs). MPC-8364.

Runs on the droplet with the standard library only. It does NOT upload: it writes newline-delimited
JSON that `bq load --source_format=NEWLINE_DELIMITED_JSON` accepts, so the transport stays a separate
decision. Everything that leaves this module is masked first (see `mask`).

What the source gives us, and does not (found by read-only discovery, 2026-10-20):
  tool name, timing, outcome and the NAMES of parameters, never argument values; no vault snapshots;
  no nonce/sender/destination region. Those columns are written empty and the matching detectors
  simply have no data. `details._raw` can hold raw tool output and is NEVER read.
"""
import argparse
import glob
import json
import os
import re
import sys
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, Iterable, Iterator, List, Optional, Tuple

MAX_TEXT = 500

# --- masking -----------------------------------------------------------------------------------
# Format-preserving: real values are replaced but the *shape* the detectors look for is kept
# (prefix, character class, length), so credentials in logs are still detected without the secret
# ever reaching BigQuery. Keep these four in step with CRED_RE in app/services/detectors.py.
_SHAPED = [
    (re.compile(r"\b(sk_live_|pk_live_)[A-Za-z0-9]+"), lambda m: m.group(1) + "X" * (len(m.group(0)) - len(m.group(1)))),
    (re.compile(r"\bAKIA[0-9A-Z]{12,}"), lambda m: "AKIA" + "X" * (len(m.group(0)) - 4)),
    (re.compile(r"(Bearer\s+)[A-Za-z0-9_\-]{40,}"), lambda m: m.group(1) + "X" * (len(m.group(0)) - len(m.group(1)))),
    (re.compile(r"(password\s*[:=]\s*)\S+", re.I), lambda m: m.group(1) + "********"),
]
# Other secret shapes the detectors do not look for are removed outright.
_OTHER = [
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?(-----END [A-Z ]*PRIVATE KEY-----|$)", re.S), "[REDACTED:private-key]"),
    (re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{5,}"), "[REDACTED:jwt]"),
    (re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}"), "[REDACTED:github-token]"),
    (re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"), "[REDACTED:slack-token]"),
    (re.compile(r"\b(?:sk-ant-|sk-)[A-Za-z0-9_\-]{20,}"), "[REDACTED:api-key]"),
    (re.compile(r"\bAIza[0-9A-Za-z_\-]{30,}"), "[REDACTED:google-key]"),
    (re.compile(r"\b(?:ntn_|secret_)[A-Za-z0-9]{20,}"), "[REDACTED:notion-token]"),
    (re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}"), "[EMAIL]"),
]


def mask(text) -> str:
    s = "" if text is None else str(text)
    for rx, repl in _OTHER:          # first, so e.g. a key inside a longer token is not half-masked
        s = rx.sub(repl, s)
    for rx, repl in _SHAPED:
        s = rx.sub(repl, s)
    return s[:MAX_TEXT]


# --- mapping ----------------------------------------------------------------------------------
TOOL_EVENTS = {"tool_execution_started", "tool_execution_completed", "tool_execution_failed", "tool_execution_denied"}
SENSITIVE_EVENT = "sensitive_data_accessed"
COLUMNS = ("ts", "text", "tool", "session", "vault_start", "vault_end", "agent_id", "nonce", "sender", "dest_region")


def _text(event: str, tool: str, d: Dict, args: Optional[Dict] = None) -> str:
    det = d.get("details") or {}
    if event == "tool_execution_started":
        keys = det.get("param_keys")
        keys = ",".join(str(k) for k in keys) if isinstance(keys, list) else str(keys or "")
        base = f"tool {tool} started; params: {keys}"          # stable text so repeated calls look identical (#51)
        if args:                                               # MPC-8428: masked values from the router sidecar
            base += " | args: " + "; ".join(f"{k}={v}" for k, v in args.items() if k != "_truncated")
        return base
    if event == "tool_execution_completed":
        return f"tool {tool} completed: {det.get('outcome_summary') or ''}"   # duration left out on purpose
    if event == "tool_execution_failed":
        return f"tool {tool} failed: {det.get('error') or ''}"
    if event == "tool_execution_denied":
        return f"tool {tool} denied: {det.get('reason') or ''}"
    cats = det.get("sensitivity_categories")
    cats = ",".join(str(c) for c in cats) if isinstance(cats, list) else str(cats or "")
    return f"sensitive data accessed ({d.get('sensitivity_level')}): {cats}"


def to_row(d: Dict, args: Optional[Dict] = None) -> Optional[Dict]:
    """One audit record -> one log-table row, or None if it is not an agent action."""
    event = d.get("event_type")
    if event not in TOOL_EVENTS and event != SENSITIVE_EVENT:
        return None
    if d.get("actor_type") != "agent" or not d.get("actor_id") or not d.get("timestamp"):
        return None
    det = d.get("details") or {}
    tool = str(d.get("target_id") or "") if d.get("target_type") == "tool" else None
    return {
        "ts": str(d["timestamp"]),
        "text": mask(_text(event, tool or "-", d, args)),
        "tool": tool,
        "session": str(d.get("correlation_id") or det.get("task_id") or "") or None,   # VERIFY: correlation_id is the session
        "vault_start": [],
        "vault_end": [],
        "agent_id": str(d["actor_id"]),
        "nonce": None,
        "sender": None,
        "dest_region": None,
    }


def read_records(paths: Iterable[str]) -> Iterator[Tuple[Optional[Dict], bool]]:
    """Yield (record, ok). Unparseable lines come back as (None, False) so they can be counted."""
    for p in paths:
        with open(p, errors="replace") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    d = json.loads(line)
                    yield (d, True) if isinstance(d, dict) else (None, False)
                except ValueError:
                    yield None, False


def load_args(paths: Iterable[str]) -> Dict[str, Dict]:
    """MPC-8428: event_id -> already-masked argument values, from the router's args-*.jsonl sidecar.
    Absent unless the router has argument logging switched on for the agent."""
    out: Dict[str, Dict] = {}
    for d, ok in read_records(paths):
        if ok and d.get("event_id") and isinstance(d.get("args"), dict):
            out[str(d["event_id"])] = d["args"]
    return out


def build_rows(paths: Iterable[str], agent: str, since: Optional[str] = None,
               args: Optional[Dict[str, Dict]] = None) -> Tuple[List[Dict], Dict]:
    rows, stats = [], Counter()
    for d, ok in read_records(paths):
        if not ok:
            stats["unparseable"] += 1
            continue
        stats["records"] += 1
        a = (args or {}).get(str(d.get("event_id"))) if d.get("event_type") == "tool_execution_started" else None
        row = to_row(d, a)
        if row is None:
            stats["skipped_not_agent_action"] += 1
        elif row["agent_id"] != agent:
            stats["skipped_other_agent"] += 1
        elif since and row["ts"] <= since:
            stats["skipped_before_since"] += 1
        else:
            rows.append(row)
            stats["loaded:" + str(d["event_type"])] += 1
            if a:
                stats["with_arg_values"] += 1
    rows.sort(key=lambda r: r["ts"])
    return rows, dict(stats)


# --- push to the ingest endpoint -----------------------------------------------------------------
BATCH_SIZE = 500


def _http_post(url: str, token: str, payload: Dict, timeout: int = 60) -> Dict:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Api-Token": token})
    with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 - https enforced by push_rows
        return json.loads(r.read() or b"{}")


def push_rows(base_url: str, agent: str, rows: List[Dict], token: str, batch_size: int = BATCH_SIZE,
              post: Optional[Callable[[str, str, Dict], Dict]] = None) -> Dict:
    """Send rows to POST {base_url}/ingest/{agent} in batches. Stops at the first failure and raises, so the
    caller never records progress for rows that were not accepted. https only: the token must not travel in clear."""
    post = post or _http_post
    if not base_url.startswith("https://"):
        raise ValueError("--push needs an https:// URL (the token must not be sent in clear)")
    if not token:
        raise ValueError("no ingest token: use --token-file or the SHADOW_INGEST_TOKEN environment variable")
    url = base_url.rstrip("/") + "/ingest/" + agent
    total = Counter()
    for i in range(0, len(rows), batch_size):
        res = post(url, token, {"rows": rows[i:i + batch_size]})
        for k in ("received", "inserted", "duplicates"):
            total[k] += int(res.get(k, 0))
    return dict(total)


def read_token(token_file: Optional[str]) -> str:
    if token_file:
        with open(token_file) as f:
            return f.read().strip()
    return os.environ.get("SHADOW_INGEST_TOKEN", "").strip()


def read_state(path: Optional[str]) -> Optional[str]:
    if path and os.path.exists(path):
        with open(path) as f:
            return json.load(f).get("since")
    return None


OVERLAP_SECONDS = 5


def overlap_start(ts: str) -> str:
    """Timestamp OVERLAP_SECONDS before ts, same ISO format. The next run re-sends a few seconds of rows
    (the ingest endpoint drops duplicates), so an event logged in the same instant as the last one is never lost."""
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00")) - timedelta(seconds=OVERLAP_SECONDS)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def write_state(path: str, since: str) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"since": since}, f)
    os.replace(tmp, path)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--agent", required=True, help="agent id, e.g. testingnt69 (non-prod only)")
    ap.add_argument("--audit-dir", default="/opt/openclaw/audit")
    ap.add_argument("--since", help="only rows with ts strictly after this ISO timestamp (printed by the previous run)")
    ap.add_argument("--out", help="write NDJSON here (omit with --dry-run)")
    ap.add_argument("--dry-run", action="store_true", help="print counts only; no rows are written, shown or sent")
    ap.add_argument("--push", metavar="URL", help="send rows to this https ingest service instead of (or as well as) --out")
    ap.add_argument("--token-file", help="file holding the ingest token (default: env SHADOW_INGEST_TOKEN)")
    ap.add_argument("--state-file", help="remember the newest pushed timestamp here; later runs start after it")
    ap.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    a = ap.parse_args(argv)
    if not a.dry_run and not a.out and not a.push:
        ap.error("give --out FILE, --push URL, or --dry-run")
    if a.state_file and not a.push:
        ap.error("--state-file only makes sense with --push")
    paths = sorted(glob.glob(a.audit_dir.rstrip("/") + "/audit-*.jsonl"))
    if not paths:
        print(f"no audit files under {a.audit_dir}", file=sys.stderr)
        return 2
    since = a.since or read_state(a.state_file)
    arg_paths = sorted(glob.glob(a.audit_dir.rstrip("/") + "/args-*.jsonl"))
    rows, stats = build_rows(paths, a.agent, since, load_args(arg_paths) if arg_paths else None)
    print(f"files: {len(paths)}  agent: {a.agent}  rows: {len(rows)}")
    for k in sorted(stats):
        print(f"  {k}: {stats[k]}")
    if rows:
        print(f"  ts range: {rows[0]['ts']} .. {rows[-1]['ts']}")
    if not a.dry_run:
        if a.out:
            with open(a.out, "w") as f:
                for r in rows:
                    f.write(json.dumps(r, ensure_ascii=False) + "\n")
            print(f"wrote {len(rows)} rows to {a.out}")
        if a.push and rows:
            try:
                sent = push_rows(a.push, a.agent, rows, read_token(a.token_file), a.batch_size)
            except (ValueError, urllib.error.URLError, OSError) as e:
                print(f"push FAILED: {type(e).__name__}: {e}", file=sys.stderr)
                return 1
            print(f"pushed: received {sent.get('received', 0)}, inserted {sent.get('inserted', 0)}, duplicates {sent.get('duplicates', 0)}")
            if a.state_file:
                resume = overlap_start(rows[-1]["ts"])
                write_state(a.state_file, resume)
                print(f"state saved: next run starts after {resume}")
        elif a.push:
            print("nothing new to push")
    return 0


if __name__ == "__main__":
    sys.exit(main())
