"""MPC-11203: OpenOSINT adapter tests.

The protocol tests run the adapter against an in-process MCP server (real MCP wire
protocol, fake OpenOSINT tools). Nothing here talks to a real OpenOSINT server or network.
"""
import asyncio
import json
import time
import unittest

from app.openosint_mcp_adapter import (
    ACTIVE_TOOLS, ERROR_API_KEY, ERROR_OTHER, ERROR_POLICY, ERROR_RATE_LIMIT, ERROR_TIMEOUT,
    DOMAIN_TOOLS, EMAIL_TOOLS, USERNAME_TOOLS, MCPToolClient, OpenOSINTAdapter,
    ProvenanceRecord, ToolError, ToolPolicy, classify_error_text,
)


class FakeClient:
    """Scripted ToolClient: behaviours maps tool -> callable(arg) -> output | raises."""

    def __init__(self, behaviours=None, default=None):
        self.behaviours = behaviours or {}
        self.default = default if default is not None else {"findings": []}
        self.inflight = 0
        self.max_inflight = 0
        self.calls = []

    async def call_tool(self, name, arguments):
        self.calls.append((name, arguments))
        self.inflight += 1
        self.max_inflight = max(self.max_inflight, self.inflight)
        try:
            await asyncio.sleep(0.05)
            b = self.behaviours.get(name)
            if b is None:
                return self.default
            return await b(arguments) if asyncio.iscoroutinefunction(b) else b(arguments)
        finally:
            self.inflight -= 1

    async def list_tool_names(self):
        return sorted({t for t, _ in EMAIL_TOOLS + USERNAME_TOOLS + DOMAIN_TOOLS})


def run(coro):
    return asyncio.run(coro)


def finding(text, source="hibp", conf=None):
    d = {"finding": text, "source": source}
    if conf is not None:
        d["confidence"] = conf
    return d


class ProvenanceTests(unittest.TestCase):
    def test_every_finding_traces_to_tool_source_timestamp(self):
        c = FakeClient({"search_breach": lambda a: {"findings": [finding("Breach X", "hibp", 0.9)]},
                        "search_email": lambda a: ["Listed on paste site"]})
        r = run(OpenOSINTAdapter(client=c).scan_email("jo@example.com", "s1"))
        self.assertEqual(r.total_findings, 2)
        for f in r.findings:
            self.assertTrue(f.tool_name and f.data_source and f.timestamp.endswith("Z"))
            self.assertFalse(f.is_active)
        by_tool = {f.tool_name: f for f in r.findings}
        self.assertEqual(by_tool["search_breach"].data_source, "hibp")
        self.assertEqual(by_tool["search_breach"].confidence, 0.9)
        # tool reported no source -> falls back to the tool name, never invented
        self.assertEqual(by_tool["search_email"].data_source, "search_email")

    def test_email_scan_searches_local_part_as_username(self):
        c = FakeClient()
        run(OpenOSINTAdapter(client=c).scan_email("jo.smith@example.com", "s1"))
        self.assertIn(("search_username", {"target": "jo.smith"}), c.calls)
        self.assertIn(("search_email", {"target": "jo.smith@example.com"}), c.calls)

    def test_dedup_keeps_highest_confidence_per_finding_and_source(self):
        c = FakeClient({"search_email": lambda a: [finding("Breach X", "hibp", 0.4)],
                        "search_breach": lambda a: [finding("Breach X", "hibp", 0.9),
                                                    finding("Breach Y", "dehashed", 0.7)]})
        r = run(OpenOSINTAdapter(client=c).scan_email("a@b.co", "s1"))
        self.assertEqual([(f.finding, f.confidence) for f in r.findings],
                         [("Breach X", 0.9), ("Breach Y", 0.7)])

    def test_confidence_clamped_and_defaulted(self):
        c = FakeClient({"search_email": lambda a: [finding("a", "s1", 7), finding("b", "s2"),
                                                   finding("c", "s3", "junk")]})
        r = run(OpenOSINTAdapter(client=c).scan_email("a@b.co", "s1"))
        conf = {f.finding: f.confidence for f in r.findings}
        self.assertEqual(conf, {"a": 1.0, "b": 0.5, "c": 0.5})

    def test_json_report_shape(self):
        c = FakeClient({"search_breach": lambda a: [finding("Breach X", "hibp", 0.9)]})
        a = OpenOSINTAdapter(client=c)
        report = json.loads(a.to_json_report(run(a.scan_email("a@b.co", "s1"))))
        self.assertEqual(report["scan_id"], "s1")
        self.assertEqual(set(report["findings"][0]), set(ProvenanceRecord.__dataclass_fields__))
        self.assertEqual(report["summary"]["tools_executed"], 3)
        self.assertEqual(report["summary"]["tool_errors"], [])


class ConcurrencyTests(unittest.TestCase):
    def test_domain_scan_runs_5_tools_concurrently(self):
        c = FakeClient()
        start = time.monotonic()
        r = run(OpenOSINTAdapter(client=c).scan_domain("example.com", "s1"))
        self.assertEqual(r.tools_executed, 5)
        self.assertEqual(c.max_inflight, 5)
        self.assertLess(time.monotonic() - start, 0.05 * 5)  # not sequential

    def test_concurrent_limit_is_enforced(self):
        c = FakeClient()
        run(OpenOSINTAdapter(client=c, concurrent_limit=2).scan_domain("example.com", "s1"))
        self.assertEqual(c.max_inflight, 2)


class ErrorHandlingTests(unittest.TestCase):
    def test_timeout_is_isolated_and_counted(self):
        async def slow(a):
            await asyncio.sleep(1)
        c = FakeClient({"search_breach": slow, "search_email": lambda a: [finding("ok")]})
        r = run(OpenOSINTAdapter(client=c, timeout_seconds=0.2).scan_email("a@b.co", "s1"))
        self.assertEqual(r.tools_failed, 1)
        self.assertEqual(r.tool_errors, [{"tool": "search_breach", "kind": ERROR_TIMEOUT}])
        self.assertEqual([f.finding for f in r.findings], ["ok"])

    def test_missing_api_key_and_rate_limit_are_classified(self):
        def no_key(a):
            raise ToolError(ERROR_API_KEY)

        def limited(a):
            raise ToolError(ERROR_RATE_LIMIT)
        c = FakeClient({"search_whois": no_key, "search_dns": limited})
        r = run(OpenOSINTAdapter(client=c).scan_domain("example.com", "s1"))
        self.assertEqual({(e["tool"], e["kind"]) for e in r.tool_errors},
                         {("search_whois", ERROR_API_KEY), ("search_dns", ERROR_RATE_LIMIT)})
        self.assertEqual(r.tools_failed, 2)

    def test_unexpected_exception_and_bad_shape_do_not_fail_scan(self):
        def boom(a):
            raise RuntimeError("secret detail jo@example.com")
        c = FakeClient({"search_email": boom, "search_breach": lambda a: {"nope": 1}})
        r = run(OpenOSINTAdapter(client=c).scan_email("jo@example.com", "s1"))
        self.assertEqual(r.tools_failed, 2)
        self.assertTrue(all(e["kind"] == ERROR_OTHER for e in r.tool_errors))
        self.assertNotIn("jo@example.com", json.dumps(r.tool_errors))

    def test_classify_error_text(self):
        self.assertEqual(classify_error_text("HTTP 429 Too Many Requests"), ERROR_RATE_LIMIT)
        self.assertEqual(classify_error_text("SHODAN_API_KEY not set (api key missing)"), ERROR_API_KEY)
        self.assertEqual(classify_error_text("connection reset"), ERROR_OTHER)


class PolicyTests(unittest.TestCase):
    def test_active_tool_blocked_when_passive_only(self):
        c = FakeClient()
        a = OpenOSINTAdapter(client=c)
        out = run(self._call(a, "scrape_url"))
        self.assertIsInstance(out, ToolError)
        self.assertEqual(out.kind, ERROR_POLICY)
        self.assertEqual(c.calls, [])

    def test_active_tool_allowed_when_policy_allows_and_flagged(self):
        c = FakeClient({"scrape_url": lambda a: [finding("page", "web")]})
        a = OpenOSINTAdapter(client=c, policy=ToolPolicy.ALLOW_ACTIVE)
        out = run(self._call(a, "scrape_url"))
        self.assertTrue(out[0].is_active)

    def test_default_scan_plans_are_passive_only(self):
        for tool, _ in EMAIL_TOOLS + USERNAME_TOOLS + DOMAIN_TOOLS:
            self.assertNotIn(tool, ACTIVE_TOOLS)

    @staticmethod
    async def _call(adapter, tool):
        return await adapter._call(tool, "x", "cat", "s1", asyncio.Semaphore(1))


class LoggingTests(unittest.TestCase):
    def test_targets_never_logged(self):
        def boom(a):
            raise RuntimeError("x")
        c = FakeClient({"search_email": boom})
        with self.assertLogs("app.openosint_mcp_adapter", level="DEBUG") as cm:
            run(OpenOSINTAdapter(client=c).scan_email("jo.smith@example.com", "s1"))
        joined = "\n".join(cm.output)
        self.assertNotIn("jo.smith", joined)
        self.assertNotIn("example.com", joined)


class MCPProtocolTests(unittest.TestCase):
    """Adapter -> MCPToolClient -> real MCP protocol -> in-process fake OpenOSINT server."""

    @classmethod
    def setUpClass(cls):
        try:
            from mcp.server.mcpserver import MCPServer
            from mcp.server.mcpserver.exceptions import ToolError as ServerToolError
        except ImportError:
            raise unittest.SkipTest("mcp SDK with MCPServer not installed")
        s = MCPServer("fake-openosint")
        names = {t for t, _ in EMAIL_TOOLS + USERNAME_TOOLS + DOMAIN_TOOLS}

        for n in names:
            def make(name):
                def tool(target: str) -> dict:
                    if name == "search_whois":
                        raise ServerToolError("WHOIS_API_KEY not set: api key missing")
                    return {"findings": [{"finding": f"{name}:hit", "source": "fake", "confidence": 0.8}]}
                tool.__name__ = name
                return tool
            s.tool()(make(n))
        cls.server = s

    def test_scan_over_mcp_protocol(self):
        a = OpenOSINTAdapter(client=MCPToolClient(self.server))
        self.assertEqual(run(a.missing_tools()), [])
        r = run(a.scan_domain("example.com", "s1"))
        self.assertEqual(r.tools_executed, 5)
        self.assertEqual(r.tool_errors, [{"tool": "search_whois", "kind": ERROR_API_KEY}])
        self.assertEqual({f.tool_name for f in r.findings},
                         {"search_domain", "search_dns", "search_rdap", "search_footprint"})
        self.assertTrue(all(f.confidence == 0.8 and f.data_source == "fake" for f in r.findings))

    def test_missing_tools_reports_gaps(self):
        class Partial(FakeClient):
            async def list_tool_names(self):
                return ["search_email"]
        missing = run(OpenOSINTAdapter(client=Partial()).missing_tools())
        self.assertIn("search_breach", missing)
        self.assertNotIn("search_email", missing)


if __name__ == "__main__":
    unittest.main()
