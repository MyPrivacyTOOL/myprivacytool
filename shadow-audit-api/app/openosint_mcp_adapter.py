"""
OpenOSINT MCP adapter for MyPrivacyTOOL exposure scanning (MPC-11203).

Launches the OpenOSINT MCP server (`openosint-mcp`, v2.38.2, stdio transport) and turns each
tool's output into provenance records:

    finding line -> tool -> data source -> timestamp -> confidence

Verified against the real openosint 2.38.2 server (see tests/fixtures/openosint_samples.json):
  - The server speaks MCP over stdio only. The adapter spawns it; there is no HTTP port.
  - openosint pins `mcp<2`, so install it in its own venv (OPENOSINT_MCP_COMMAND points at it).
  - Each tool takes its own argument name (email / domain / query / target); see TOOLS.
  - Output is JSON text: {"tool", "target", "timestamp", "results": [str, ...], "error"}.
    Failures (missing key, network error) come back as result lines with is_error=False.
  - OpenOSINT gives no per-finding source or confidence. `data_source` here is the service the
    tool queries (from OpenOSINT's own tool policy notes); `confidence` is UNSCORED_CONFIDENCE.
  - In passive mode the server does not list, and refuses, its noisy tools: search_email
    (holehe), search_username (sherlock), search_domain (sublist3r), search_phone, scrape_url.
    holehe probes sign-up/reset flows and may notify the account owner. This adapter never calls
    them under ToolPolicy.PASSIVE_ONLY.

Behaviour:
  - Up to `concurrent_limit` tool calls run concurrently over one server session per scan, each
    with a timeout (OpenOSINT's own per-tool default unless `timeout_seconds` overrides it).
  - Per-tool failures never fail the scan; they are counted and classified
    (timeout / api_key_missing / rate_limited / policy_blocked / error) in `tool_errors`.
  - Targets (emails, usernames, domains) are never written to logs.
"""

import asyncio
import contextlib
import json
import logging
import os
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, AsyncIterator, Dict, List, Optional, Protocol, Tuple

logger = logging.getLogger(__name__)
logger.setLevel(os.getenv("OPENOSINT_LOG_LEVEL", "INFO"))

# tool -> (argument name, data source queried, category, default timeout seconds).
# Passive tools only (OpenOSINT TOOL_POLICY noise == passive); timeouts are OpenOSINT's own
# _DEFAULT_TIMEOUT values (search_footprint has none published, 30 assumed).
TOOLS: Dict[str, Tuple[str, str, str, float]] = {
    "search_breach": ("email", "haveibeenpwned.com", "breach_databases", 15),
    "search_paste": ("query", "psbdmp.ws", "paste_sites", 15),
    "search_github": ("query", "api.github.com", "code_hosting", 30),
    "search_footprint": ("target", "google via Bright Data", "public_footprint", 30),
    "search_whois": ("domain", "whois registry", "domain_registries", 15),
    "search_rdap": ("domain", "rdap registry", "domain_registries", 10),
    "search_dns": ("domain", "dns resolver", "dns_records", 10),
    "search_virustotal": ("target", "virustotal.com", "reputation", 30),
}
PASSIVE_TOOLS = frozenset(TOOLS)
# Not passive per OpenOSINT: refused under ToolPolicy.PASSIVE_ONLY.
NON_PASSIVE_TOOLS = frozenset({
    "search_email", "search_username", "search_domain", "search_phone", "scrape_url",
})

# Confidence when the tool reports none. It means "unscored", not "50% likely".
UNSCORED_CONFIDENCE = 0.5

PLANS: Dict[str, List[str]] = {
    "email": ["search_breach", "search_paste", "search_github"],
    "username": ["search_github", "search_paste", "search_footprint"],
    "domain": ["search_whois", "search_rdap", "search_dns", "search_virustotal", "search_footprint"],
}

_FORWARDED_ENV = (
    "PATH", "HOME", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy", "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE", "HIBP_API_KEY", "GITHUB_TOKEN", "VIRUSTOTAL_API_KEY", "SHODAN_API_KEY",
    "CENSYS_API_ID", "CENSYS_API_SECRET", "ABUSEIPDB_API_KEY", "BRIGHTDATA_API_KEY",
)


class ToolPolicy(Enum):
    PASSIVE_ONLY = "passive_only"
    ALLOW_ACTIVE = "allow_active"


ERROR_TIMEOUT = "timeout"
ERROR_API_KEY = "api_key_missing"
ERROR_RATE_LIMIT = "rate_limited"
ERROR_POLICY = "policy_blocked"
ERROR_OTHER = "error"


class ToolError(Exception):
    """A tool call failed. `kind` is one of the ERROR_* constants."""

    def __init__(self, kind: str, message: str = ""):
        super().__init__(message or kind)
        self.kind = kind


class ToolSession(Protocol):
    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        """Return the tool's decoded output. Raise ToolError on a tool-level error."""


class ToolClient(Protocol):
    def session(self) -> "contextlib.AbstractAsyncContextManager[ToolSession]": ...

    async def list_tool_names(self) -> List[str]: ...


def classify_error_text(text: str) -> str:
    """Map an error message to an ERROR_* kind. A bare HTTP 401/403 is not treated as a missing
    key: a proxy or firewall refusal also says 403 (seen in the live run)."""
    t = text.lower()
    if "rate limit" in t or "429" in t or "too many requests" in t:
        return ERROR_RATE_LIMIT
    if "disabled_in_passive_mode" in t:
        return ERROR_POLICY
    if "key_required" in t or "api key" in t or "api_key" in t or "apikey" in t:
        return ERROR_API_KEY
    return ERROR_OTHER


class _MCPSession:
    def __init__(self, client: Any):
        self._client = client

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        result = await self._client.call_tool(name, arguments)
        text = "\n".join(getattr(c, "text", "") for c in result.content)
        if getattr(result, "is_error", False):
            raise ToolError(classify_error_text(text), text[:200])
        try:
            return json.loads(text)
        except ValueError:
            raise ToolError(ERROR_OTHER, "tool returned non-JSON output")


class MCPToolClient:
    """ToolClient that spawns the OpenOSINT MCP server over stdio via the MCP Python SDK
    (mcp>=2.3 `mcp.Client`; it works against the server's mcp 1.x). Pass `server` to use any
    other transport accepted by mcp.Client (a URL, or an in-process server in tests)."""

    def __init__(self, server: Any = None, allow_active: bool = False):
        self._server = server
        self._allow_active = allow_active

    def _target(self) -> Any:
        if self._server is not None:
            return self._server
        from mcp import StdioServerParameters

        env = {k: os.environ[k] for k in _FORWARDED_ENV if k in os.environ}
        env["OPENOSINT_ALLOW_ACTIVE"] = "1" if self._allow_active else "0"
        return StdioServerParameters(
            command=os.getenv("OPENOSINT_MCP_COMMAND", "openosint-mcp"), args=[], env=env)

    @contextlib.asynccontextmanager
    async def session(self) -> AsyncIterator[ToolSession]:
        from mcp import Client  # imported lazily so the adapter loads without the SDK

        async with Client(self._target()) as client:
            yield _MCPSession(client)

    async def list_tool_names(self) -> List[str]:
        from mcp import Client

        async with Client(self._target()) as client:
            return [t.name for t in (await client.list_tools()).tools]


@dataclass
class ProvenanceRecord:
    """Source of one finding."""
    finding: str
    tool_name: str
    data_source: str
    timestamp: str  # ISO 8601 UTC
    confidence: float  # 0.0-1.0; UNSCORED_CONFIDENCE (OpenOSINT reports none)
    tool_category: str
    is_active: bool  # True only for non-passive tools

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ExposureResult:
    target: str
    findings: List[ProvenanceRecord]
    scan_id: str
    timestamp: str
    total_findings: int
    tools_executed: int
    tools_failed: int
    execution_time_seconds: float
    tool_errors: List[Dict[str, str]] = field(default_factory=list)  # [{"tool", "kind"}]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


_EMPTY_RESULT = re.compile(r"^No .+ (found|mentioning)\b", re.IGNORECASE)


class OpenOSINTAdapter:
    def __init__(
        self,
        mcp_port: int = 8000,  # unused: kept so existing callers keep working (stdio, no port)
        policy: ToolPolicy = ToolPolicy.PASSIVE_ONLY,
        concurrent_limit: int = 5,
        timeout_seconds: Optional[float] = None,
        enable_provenance: bool = True,
        client: Optional[ToolClient] = None,
    ):
        self.policy = policy
        self.concurrent_limit = concurrent_limit
        self.timeout_seconds = timeout_seconds  # None: use each tool's own default
        self.enable_provenance = enable_provenance
        self.mcp_client: ToolClient = client or MCPToolClient(
            allow_active=policy is ToolPolicy.ALLOW_ACTIVE)
        logger.info("OpenOSINT adapter: policy=%s concurrent_limit=%s timeout=%s",
                    policy.value, concurrent_limit, timeout_seconds or "per-tool default")

    async def missing_tools(self) -> List[str]:
        """Tools this adapter uses that the server does not offer (empty = all present)."""
        wanted = {t for plan in PLANS.values() for t in plan}
        return sorted(wanted - set(await self.mcp_client.list_tool_names()))

    async def scan_email(self, email: str, scan_id: str) -> ExposureResult:
        return await self._run(email, scan_id, "email")

    async def scan_username(self, username: str, scan_id: str) -> ExposureResult:
        return await self._run(username, scan_id, "username")

    async def scan_domain(self, domain: str, scan_id: str) -> ExposureResult:
        return await self._run(domain, scan_id, "domain")

    async def _run(self, target: str, scan_id: str, kind: str) -> ExposureResult:
        started = datetime.now(timezone.utc)
        plan = PLANS[kind]
        semaphore = asyncio.Semaphore(self.concurrent_limit)
        try:
            async with self.mcp_client.session() as session:
                outcomes = await asyncio.gather(
                    *(self._call(session, tool, target, scan_id, semaphore) for tool in plan))
        except Exception as e:  # server could not start / died: every tool failed
            logger.warning("scan %s: OpenOSINT session failed: %s", scan_id, type(e).__name__)
            outcomes = [ToolError(ERROR_OTHER, type(e).__name__) for _ in plan]
        findings: List[ProvenanceRecord] = []
        errors: List[Dict[str, str]] = []
        for tool, outcome in zip(plan, outcomes):
            if isinstance(outcome, ToolError):
                errors.append({"tool": tool, "kind": outcome.kind})
            else:
                findings.extend(outcome)
        findings = self.deduplicate_findings(findings)
        return ExposureResult(
            target=target,
            findings=findings,
            scan_id=scan_id,
            timestamp=_now(),
            total_findings=len(findings),
            tools_executed=len(plan),
            tools_failed=len(errors),
            execution_time_seconds=(datetime.now(timezone.utc) - started).total_seconds(),
            tool_errors=errors,
        )

    async def _call(self, session: ToolSession, tool: str, target: str, scan_id: str,
                    semaphore: asyncio.Semaphore):
        """Run one tool. Returns a list of ProvenanceRecord, or a ToolError (never raises)."""
        if tool not in PASSIVE_TOOLS and self.policy is not ToolPolicy.ALLOW_ACTIVE:
            logger.warning("scan %s: tool %s blocked by passive-only policy", scan_id, tool)
            return ToolError(ERROR_POLICY, tool)
        arg, _, _, default_timeout = TOOLS.get(tool, ("target", tool, "other", 30))
        timeout = self.timeout_seconds if self.timeout_seconds is not None else default_timeout
        try:
            async with semaphore:
                raw = await asyncio.wait_for(
                    session.call_tool(tool, {arg: target, "json_output": True}), timeout)
        except asyncio.TimeoutError:
            logger.warning("scan %s: tool %s timed out after %ss", scan_id, tool, timeout)
            return ToolError(ERROR_TIMEOUT, tool)
        except ToolError as e:
            logger.warning("scan %s: tool %s failed: %s", scan_id, tool, e.kind)
            return e
        except Exception as e:  # transport errors etc.
            logger.warning("scan %s: tool %s failed: %s", scan_id, tool, type(e).__name__)
            return ToolError(ERROR_OTHER, type(e).__name__)
        try:
            return self._records(raw, tool)
        except ToolError as e:
            logger.warning("scan %s: tool %s: %s", scan_id, tool, e.kind)
            return e

    def _records(self, raw: Any, tool: str) -> List[ProvenanceRecord]:
        """Turn OpenOSINT's {"results": [lines], "error": ...} output into records."""
        if not isinstance(raw, dict) or not isinstance(raw.get("results"), list):
            raise ToolError(ERROR_OTHER, "unexpected output shape")
        if raw.get("error"):
            raise ToolError(classify_error_text(str(raw["error"])), "tool reported an error")
        lines = [str(x).strip() for x in raw["results"] if str(x).strip()]
        # The server reports failures as result lines: "Scan error: ...", "[key_required] KEY".
        failed = [ln for ln in lines if ln.startswith("Scan error:") or ln.startswith("[key_required]")]
        if failed:
            raise ToolError(classify_error_text(" ".join(failed)), "tool reported a scan error")
        _, source, category, _ = TOOLS.get(tool, ("target", tool, "other", 30))
        now = _now()
        return [
            ProvenanceRecord(
                finding=ln, tool_name=tool, data_source=source, timestamp=now,
                confidence=UNSCORED_CONFIDENCE, tool_category=category,
                is_active=tool not in PASSIVE_TOOLS)
            for ln in lines if not _EMPTY_RESULT.match(ln)
        ]

    def deduplicate_findings(self, findings: List[ProvenanceRecord]) -> List[ProvenanceRecord]:
        """One record per (finding, data_source), keeping the highest confidence; sorted by it."""
        best: Dict[Tuple[str, str], ProvenanceRecord] = {}
        for f in findings:
            key = (f.finding, f.data_source)
            if key not in best or f.confidence > best[key].confidence:
                best[key] = f
        return sorted(best.values(), key=lambda f: f.confidence, reverse=True)

    def to_json_report(self, result: ExposureResult) -> str:
        return json.dumps(
            {
                "scan_id": result.scan_id,
                "target": result.target,
                "timestamp": result.timestamp,
                "findings": [f.to_dict() for f in result.findings],
                "summary": {
                    "total_findings": result.total_findings,
                    "tools_executed": result.tools_executed,
                    "tools_failed": result.tools_failed,
                    "execution_time_seconds": result.execution_time_seconds,
                    "tool_errors": result.tool_errors,
                },
            },
            indent=2,
        )
