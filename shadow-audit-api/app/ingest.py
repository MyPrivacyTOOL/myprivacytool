"""Log-row ingest (MPC-8364). Receives MASKED rows from the droplet loader and appends them to the
log table the audit reads. Defence in depth: rows are validated, masked AGAIN here, filtered by an
agent allowlist, and de-duplicated, so re-sending a window never creates duplicates.

The BigQuery sink is an untested adapter (needs GCP); everything else runs against an in-memory sink."""
import hashlib
import re
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Protocol, Set, Tuple

from loader.audit_log_loader import MAX_TEXT, mask

AGENT_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
MAX_ROWS = 1000
ALLOWED_KEYS = {"ts", "text", "tool", "session", "vault_start", "vault_end", "agent_id", "nonce", "sender", "dest_region"}
STRING_LIMITS = {"tool": 100, "session": 200, "nonce": 200, "sender": 200, "dest_region": 50}
MAX_RAW_TEXT = 4000
MAX_VAULT_ITEMS = 50

Key = Tuple[str, str, str, str]


class IngestError(Exception):
    """Carries an HTTP status and a message that never echoes row content."""
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status, self.message = status, message


def parse_ts(value) -> datetime:
    if not isinstance(value, str):
        raise ValueError("ts must be a string")
    dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def row_key(agent_id: str, ts, tool: Optional[str], session: Optional[str], text: str) -> Key:
    dt = ts if isinstance(ts, datetime) else parse_ts(ts)
    dt = dt.astimezone(timezone.utc)
    stamp = dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}"   # millisecond precision
    return (stamp, tool or "", session or "", hashlib.sha256(text.encode("utf-8", "replace")).hexdigest())


def validate_rows(agent_id: str, rows) -> List[Dict]:
    """Return clean, masked rows or raise IngestError(400). Error text names the row index and field only."""
    if not isinstance(rows, list) or not rows:
        raise IngestError(400, "rows must be a non-empty list")
    if len(rows) > MAX_ROWS:
        raise IngestError(400, f"at most {MAX_ROWS} rows per request")
    out = []
    for i, r in enumerate(rows):
        if not isinstance(r, dict):
            raise IngestError(400, f"row {i}: must be an object")
        extra = set(r) - ALLOWED_KEYS
        if extra:
            raise IngestError(400, f"row {i}: unknown field(s) {sorted(extra)}")
        if r.get("agent_id") != agent_id:
            raise IngestError(400, f"row {i}: agent_id does not match the URL")
        try:
            parse_ts(r.get("ts"))
        except (ValueError, TypeError):
            raise IngestError(400, f"row {i}: ts must be an ISO-8601 timestamp")
        text = r.get("text")
        if not isinstance(text, str) or len(text) > MAX_RAW_TEXT:
            raise IngestError(400, f"row {i}: text must be a string of at most {MAX_RAW_TEXT} characters")
        clean = {"ts": r["ts"], "text": mask(text)[:MAX_TEXT], "agent_id": agent_id}
        for f, limit in STRING_LIMITS.items():
            v = r.get(f)
            if v is not None and (not isinstance(v, str) or len(v) > limit):
                raise IngestError(400, f"row {i}: {f} must be a string of at most {limit} characters or null")
            clean[f] = None if v is None else mask(v)
        for f in ("vault_start", "vault_end"):
            v = r.get(f) or []
            if not isinstance(v, list) or len(v) > MAX_VAULT_ITEMS or not all(isinstance(x, str) and len(x) <= 200 for x in v):
                raise IngestError(400, f"row {i}: {f} must be a list of at most {MAX_VAULT_ITEMS} short strings")
            clean[f] = [mask(x) for x in v]
        out.append(clean)
    return out


class Sink(Protocol):
    def existing_keys(self, agent_id: str, lo: datetime, hi: datetime) -> Set[Key]: ...
    def append(self, rows: List[Dict]) -> None: ...


class InMemorySink:
    def __init__(self):
        self.rows: List[Dict] = []

    def existing_keys(self, agent_id, lo, hi):
        return {row_key(r["agent_id"], r["ts"], r.get("tool"), r.get("session"), r["text"])
                for r in self.rows if r["agent_id"] == agent_id}

    def append(self, rows):
        self.rows.extend(rows)


class BigQuerySink:  # untested adapter; needs google-cloud-bigquery and credentials (dataEditor on the dataset)
    def __init__(self, table: str):
        self.table = table

    def existing_keys(self, agent_id, lo, hi):
        from google.cloud import bigquery
        client = bigquery.Client()
        job = client.query(
            f"SELECT ts, tool, session, text FROM `{self.table}` WHERE agent_id=@a AND ts BETWEEN @lo AND @hi",
            job_config=bigquery.QueryJobConfig(query_parameters=[
                bigquery.ScalarQueryParameter("a", "STRING", agent_id),
                bigquery.ScalarQueryParameter("lo", "TIMESTAMP", lo),
                bigquery.ScalarQueryParameter("hi", "TIMESTAMP", hi)]))
        return {row_key(agent_id, r["ts"], r["tool"], r["session"], r["text"]) for r in job.result()}

    def append(self, rows):
        from google.cloud import bigquery
        client = bigquery.Client()
        job = client.load_table_from_json(rows, self.table, job_config=bigquery.LoadJobConfig(
            source_format=bigquery.SourceFormat.NEWLINE_DELIMITED_JSON, write_disposition="WRITE_APPEND"))
        job.result()


class IngestService:
    def __init__(self, sink: Sink, allowed_agents: Iterable[str]):
        self.sink, self.allowed = sink, set(allowed_agents)

    def ingest(self, agent_id: str, rows) -> Dict:
        if not AGENT_RE.match(agent_id or ""):
            raise IngestError(400, "invalid agent id")
        if agent_id not in self.allowed:
            raise IngestError(403, "agent is not enabled for ingest")
        clean = validate_rows(agent_id, rows)
        stamps = [parse_ts(r["ts"]) for r in clean]
        try:
            known = self.sink.existing_keys(agent_id, min(stamps), max(stamps))
        except Exception:  # noqa: BLE001 - never report a partial or blind write as success
            raise IngestError(502, "could not check existing rows")
        fresh, seen = [], set(known)
        for r in clean:
            k = row_key(agent_id, r["ts"], r["tool"], r["session"], r["text"])
            if k not in seen:
                seen.add(k)
                fresh.append(r)
        if fresh:
            try:
                self.sink.append(fresh)
            except Exception:  # noqa: BLE001
                raise IngestError(502, "could not write rows")
        return {"received": len(clean), "inserted": len(fresh), "duplicates": len(clean) - len(fresh)}
