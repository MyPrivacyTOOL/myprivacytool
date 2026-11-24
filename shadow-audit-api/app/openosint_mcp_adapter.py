"""
OpenOSINT MCP adapter for MyPrivacyTOOL exposure scanning (MPC-11203).

Calls an OpenOSINT MCP server (v2.38.2+) over the MCP protocol and turns each tool's
output into statement-level provenance records:

    finding -> tool -> data source -> timestamp -> confidence

Behaviour:
  - Up to `concurrent_limit` (default 5) tool calls run concurrently, each with a
    `timeout_seconds` (default 5s) limit.
  - Passive-only by default. Active tools (scrapers) are refused unless the adapter is
    built with ToolPolicy.ALLOW_ACTIVE.
  - Per-tool failures never fail the scan; they are counted and classified
    (timeout / api_key_missing / rate_limited / policy_blocked / error) in `tool_errors`.
  - Targets (emails, usernames, domains) are never written to logs.

Assumptions about the OpenOSINT server, to be confirmed against a live server with
`OpenOSINTAdapter.missing_tools()` and the live-scan step of MPC-11203:
  - tool names match the registry in the task spec (search_email, search_breach, ...)
  - each tool takes {"target": <str>} and returns JSON text, either a list or
    {"findings": [...]}, each finding being a string or an object with `finding`
    (or `title`/`name`), `source` (or `data_source`) and optional `confidence` (0..1).
"""

import asyncio
import json
import logging
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Protocol, Tuple

logger = logging.getLogger(__name__)
logger.setLevel(os.getenv("OPENOSINT_LOG_LEVEL", "INFO"))

# Tools that run without active network probing of the target. Names from the MPC-11203 spec.
PASSIVE_TOOLS = frozenset({
    "search_email", "search_username", "search_whois", "search_dns", "search_rdap",
    "search_ip", "search_domain", "generate_dorks", "search_github", "search_paste",
    "search_phone", "search_breach", "search_virustotal", "search_censys",
    "search_ip2location", "search_abuseipdb", "search_shodan", "search_gdelt_geo",
    "search_footprint",
})
ACTIVE_TOOLS = frozenset({"scrape_url", "search_dorks_live"})

# Confidence used when a tool does not report one. It means "unscored", not "50% likely".
UNSCORED_CONFIDENCE = 0.5

# (tool, category) pairs per scan type.
EMAIL_TOOLS: List[Tuple[str, str]] = [
    ("search_email", "email_search"),
    ("search_breach", "breach_databases"),
]
USERNAME_TOOLS: List[Tuple[str, str]] = [
    ("search_username", "social_platforms"),
    ("search_footprint", "public_footprint"),
]
DOMAIN_TOOLS: List[Tuple[str, str]] = [
    ("search_domain", "domain_lookup"),
    ("search_whois", "domain_registries"),
    ("search_dns", "dns_records"),
    ("search_rdap", "domain_registries"),
    ("search_footprint", "public_footprint"),
]


class ToolPolicy(Enum):
    PASSIVE_ONLY = "passive_only"
    ALLOW_ACTIVE = "allow_active"


class ToolError(Exception):
    """A tool call failed. `kind` is one of the ERROR_* constants."""

    def __init__(self, kind: str, message: str = ""):
        super().__init__(message or kind)
        self.kind = kind


ERROR_TIMEOUT = "timeout"
ERROR_API_KEY = "api_key_missing"
ERROR_RATE_LIMIT = "rate_limited"
ERROR_POLICY = "policy_blocked"
ERROR_OTHER = "error"


class ToolClient(Protocol):
    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        """Return the tool's decoded JSON output. Raise ToolError on a tool-level error."""

    async def list_tool_names(self) -> List[str]: ...


def classify_error_text(text: str) -> str:
    t = text.lower()
    if "rate limit" in t or "429" in t or "too many requests" in t:
        return ERROR_RATE_LIMIT
    if ("api key" in t or "api_key" in t or "apikey" in t or "unauthorized" in t
            or "401" in t or "403" in t) and ("missing" in t or "not set" in t or "invalid" in t
                                              or "required" in t or "unauthorized" in t
                                              or "401" in t or "403" in t):
        return ERROR_API_KEY
    return ERROR_OTHER


class MCPToolClient:
    """ToolClient backed by the MCP Python SDK (`mcp.Client`, streamable HTTP or in-process)."""

    def __init__(self, server: Any):
        self._server = server  # URL string, or anything mcp.Client accepts

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        from mcp import Client  # imported lazily so the adapter loads without the SDK

        async with Client(self._server) as client:
            result = await client.call_tool(name, arguments)
        text = "\n".join(getattr(c, "text", "") for c in result.content)
        if getattr(result, "is_error", False):
            raise ToolError(classify_error_text(text), text[:200])
        if getattr(result, "structured_content", None) is not None:
            return result.structured_content
        try:
            return json.loads(text)
        except ValueError:
            raise ToolError(ERROR_OTHER, "tool returned non-JSON output")

    async def list_tool_names(self) -> List[str]:
        from mcp import Client

        async with Client(self._server) as client:
            listing = await client.list_tools()
        return [t.name for t in listing.tools]


@dataclass
class ProvenanceRecord:
    """Source of one finding."""
    finding: str
    tool_name: str
    data_source: str
    timestamp: str  # ISO 8601 UTC
    confidence: float  # 0.0-1.0; UNSCORED_CONFIDENCE when the tool reports none
    tool_category: str
    is_active: bool  # True only for active (scraping) tools

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


def _to_confidence(value: Any) -> float:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return UNSCORED_CONFIDENCE
    return min(1.0, max(0.0, v))


class OpenOSINTAdapter:
    def __init__(
        self,
        mcp_port: int = 8000,
        policy: ToolPolicy = ToolPolicy.PASSIVE_ONLY,
        concurrent_limit: int = 5,
        timeout_seconds: float = 5.0,
        enable_provenance: bool = True,
        client: Optional[ToolClient] = None,
    ):
        self.mcp_port = mcp_port
        self.policy = policy
        self.concurrent_limit = concurrent_limit
        self.timeout_seconds = timeout_seconds
        self.enable_provenance = enable_provenance
        self.mcp_client: ToolClient = client or MCPToolClient(
            os.getenv("OPENOSINT_MCP_URL", f"http://localhost:{mcp_port}").rstrip("/") + "/mcp"
        )
        logger.info("OpenOSINT adapter: policy=%s concurrent_limit=%s timeout=%ss",
                    policy.value, concurrent_limit, timeout_seconds)

    async def missing_tools(self) -> List[str]:
        """Tool names this adapter uses that the server does not offer (empty = all present)."""
        wanted = {t for t, _ in EMAIL_TOOLS + USERNAME_TOOLS + DOMAIN_TOOLS}
        return sorted(wanted - set(await self.mcp_client.list_tool_names()))

    async def scan_email(self, email: str, scan_id: str) -> ExposureResult:
        local = email.split("@", 1)[0]
        plan = [(t, email, c) for t, c in EMAIL_TOOLS] + [("search_username", local, "social_platforms")]
        return await self._run(email, scan_id, plan)

    async def scan_username(self, username: str, scan_id: str) -> ExposureResult:
        return await self._run(username, scan_id, [(t, username, c) for t, c in USERNAME_TOOLS])

    async def scan_domain(self, domain: str, scan_id: str) -> ExposureResult:
        return await self._run(domain, scan_id, [(t, domain, c) for t, c in DOMAIN_TOOLS])

    async def _run(self, target: str, scan_id: str, plan: List[Tuple[str, str, str]]) -> ExposureResult:
        started = datetime.now(timezone.utc)
        semaphore = asyncio.Semaphore(self.concurrent_limit)
        outcomes = await asyncio.gather(
            *(self._call(tool, arg, category, scan_id, semaphore) for tool, arg, category in plan)
        )
        findings: List[ProvenanceRecord] = []
        errors: List[Dict[str, str]] = []
        for (tool, _, _), outcome in zip(plan, outcomes):
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

    async def _call(self, tool: str, arg: str, category: str, scan_id: str,
                    semaphore: asyncio.Semaphore):
        """Run one tool. Returns a list of ProvenanceRecord, or a ToolError (never raises)."""
        is_active = tool in ACTIVE_TOOLS
        if is_active and self.policy is not ToolPolicy.ALLOW_ACTIVE:
            logger.warning("scan %s: active tool %s blocked by passive-only policy", scan_id, tool)
            return ToolError(ERROR_POLICY, tool)
        try:
            async with semaphore:
                raw = await asyncio.wait_for(
                    self.mcp_client.call_tool(tool, {"target": arg}), self.timeout_seconds)
        except asyncio.TimeoutError:
            logger.warning("scan %s: tool %s timed out after %ss", scan_id, tool, self.timeout_seconds)
            return ToolError(ERROR_TIMEOUT, tool)
        except ToolError as e:
            logger.warning("scan %s: tool %s failed: %s", scan_id, tool, e.kind)
            return e
        except Exception as e:  # transport errors etc.
            logger.warning("scan %s: tool %s failed: %s", scan_id, tool, type(e).__name__)
            return ToolError(ERROR_OTHER, type(e).__name__)
        try:
            return self._records(raw, tool, category, is_active)
        except ToolError as e:
            logger.warning("scan %s: tool %s returned unexpected output", scan_id, tool)
            return e

    def _records(self, raw: Any, tool: str, category: str, is_active: bool) -> List[ProvenanceRecord]:
        items = raw.get("findings") if isinstance(raw, dict) else raw
        if not isinstance(items, list):
            raise ToolError(ERROR_OTHER, "unexpected output shape")
        now = _now()
        records = []
        for item in items:
            if isinstance(item, str):
                item = {"finding": item}
            if not isinstance(item, dict):
                continue
            text = item.get("finding") or item.get("title") or item.get("name")
            if not text:
                continue
            records.append(ProvenanceRecord(
                finding=str(text),
                tool_name=tool,
                data_source=str(item.get("source") or item.get("data_source") or tool),
                timestamp=now,
                confidence=_to_confidence(item.get("confidence")),
                tool_category=category,
                is_active=is_active,
            ))
        return records

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
