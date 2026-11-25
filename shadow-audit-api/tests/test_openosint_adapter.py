"""MPC-11203: OpenOSINT adapter tests.

tests/fixtures/openosint_samples.json holds real outputs captured from openosint 2.38.2
(`openosint-mcp`, stdio, passive mode). Everything else uses fakes or an in-process MCP server;
no test here needs network or a real OpenOSINT install, except the one opt-in live test
(set OPENOSINT_MCP_COMMAND to the `openosint-mcp` binary to run it).
"""
import asyncio
import contextlib
import json
import os
import time
import unittest
from pathlib import Path

from app.openosint_mcp_adapter import (
    ERROR_API_KEY, ERROR_OTHER, ERROR_POLICY, ERROR_RATE_LIMIT, ERROR_TIMEOUT,
    NON_PASSIVE_TOOLS, PASSIVE_TOOLS, PLANS, TOOLS, MCPToolClient, OpenOSINTAdapter,
    ProvenanceRecord, ToolError, ToolPolicy, classify_error_text,
)

SAMPLES = json.loads((Path(__file__).parent / "fixtures" / "openosint_samples.json").read_text())


def out(*lines, error=None):
    return {"tool": "x", "target": "t", "timestamp": "2026-11-24T00:00:00+00:00",
            "results": list(lines), "error": error}


class FakeClient:
    """Scripted ToolClient: behaviours maps tool -> callable(arguments) -> output | raises."""

    def __init__(self, behaviours=None, default=None, fail_session=False):
        self.behaviours = behaviours or {}
        self.default = default if default is not None else out()
        self.fail_session = fail_session
        self.inflight = 0
        self.max_inflight = 0
        self.calls = []

    @contextlib.asynccontextmanager
    async def session(self):
        if self.fail_session:
            raise RuntimeError("server did not start for jo@example.com")
        yield self

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
        return sorted({t for plan in PLANS.values() for t in plan})


def run(coro):
    return asyncio.run(coro)


def parse(sample_key, tool):
    return OpenOSINTAdapter(client=FakeClient())._records(json.loads(SAMPLES[sample_key]["text"]), tool)


class RealOutputTests(unittest.TestCase):
    """Parsing of outputs captured from the real server."""

    def test_dns_output_becomes_provenance_records(self):
        recs = parse("dns_ok", "search_dns")
        self.assertTrue(any("A:" in r.finding for r in recs))
        for r in recs:
            self.assertEqual((r.tool_name, r.data_source, r.tool_category),
                             ("search_dns", "dns resolver", "dns_records"))
            self.assertTrue(r.timestamp.endswith("Z"))
            self.assertFalse(r.is_active)

    def test_missing_key_is_classified(self):
        with self.assertRaises(ToolError) as cm:
            parse("breach_key_missing", "search_breach")
        self.assertEqual(cm.exception.kind, ERROR_API_KEY)

    def test_network_errors_are_not_missing_keys(self):
        for key, tool in (("github_network_error", "search_github"),
                          ("whois_network_error", "search_whois"),
                          ("rdap_proxy_403", "search_rdap")):  # proxy says "403": not a key problem
            with self.assertRaises(ToolError, msg=key) as cm:
                parse(key, tool)
            self.assertEqual(cm.exception.kind, ERROR_OTHER, key)

    def test_server_refusal_of_noisy_tool_is_policy(self):
        self.assertTrue(SAMPLES["noisy_blocked"]["is_error"])
        self.assertEqual(classify_error_text(SAMPLES["noisy_blocked"]["text"]), ERROR_POLICY)

    def test_adapter_tools_match_real_passive_tool_listing(self):
        listed = set(SAMPLES["tool_names"])
        self.assertTrue(PASSIVE_TOOLS <= listed, PASSIVE_TOOLS - listed)
        self.assertTrue(all(t in listed for plan in PLANS.values() for t in plan))
        self.assertFalse(NON_PASSIVE_TOOLS & listed)  # server hides them in passive mode
        self.assertFalse(NON_PASSIVE_TOOLS & set(TOOLS))
        for plan in PLANS.values():
            self.assertTrue(set(plan) <= PASSIVE_TOOLS)

    def test_classify_error_text(self):
        self.assertEqual(classify_error_text("HIBP rate limit exceeded"), ERROR_RATE_LIMIT)
        self.assertEqual(classify_error_text("[key_required] HIBP_API_KEY"), ERROR_API_KEY)
        self.assertEqual(classify_error_text("Tunnel connection failed: 403 Forbidden"), ERROR_OTHER)


class ScanTests(unittest.TestCase):
    def test_tools_get_their_own_argument_names(self):
        c = FakeClient()
        run(OpenOSINTAdapter(client=c).scan_email("jo@example.com", "s1"))
        run(OpenOSINTAdapter(client=c).scan_domain("example.com", "s2"))
        calls = dict(c.calls)
        self.assertEqual(calls["search_breach"], {"email": "jo@example.com", "json_output": True})
        self.assertEqual(calls["search_github"], {"query": "jo@example.com", "json_output": True})
        self.assertEqual(calls["search_whois"], {"domain": "example.com", "json_output": True})
        self.assertEqual(calls["search_virustotal"], {"target": "example.com", "json_output": True})

    def test_findings_have_full_provenance_and_dedup(self):
        c = FakeClient({"search_whois": lambda a: out("Registrar: X", "Registrar: X", "Created: 2020"),
                        "search_dns": lambda a: out("[DNS] A: 1.2.3.4")})
        r = run(OpenOSINTAdapter(client=c).scan_domain("example.com", "s1"))
        got = sorted((f.tool_name, f.finding, f.data_source) for f in r.findings)
        self.assertEqual(got, [("search_dns", "[DNS] A: 1.2.3.4", "dns resolver"),
                               ("search_whois", "Created: 2020", "whois registry"),
                               ("search_whois", "Registrar: X", "whois registry")])
        self.assertTrue(all(f.confidence == 0.5 for f in r.findings))

    def test_no_result_lines_are_not_findings(self):
        c = FakeClient({"search_breach": lambda a: out("No breaches found for 'a@b.co'."),
                        "search_github": lambda a: out("[GitHub] No users found for query: 'a@b.co'.")})
        r = run(OpenOSINTAdapter(client=c).scan_email("a@b.co", "s1"))
        self.assertEqual(r.total_findings, 0)
        self.assertEqual(r.tools_failed, 0)

    def test_dns_warnings_are_findings_not_empty_results(self):
        c = FakeClient({"search_dns": lambda a: out("[!] No SPF record found - anyone can spoof email")})
        r = run(OpenOSINTAdapter(client=c).scan_domain("example.com", "s1"))
        self.assertEqual(r.total_findings, 1)

    def test_paste_search_is_not_in_any_plan(self):
        self.assertTrue(all("search_paste" not in plan for plan in PLANS.values()))

    def test_json_report_shape(self):
        c = FakeClient({"search_dns": lambda a: out("[DNS] A: 1.2.3.4")})
        a = OpenOSINTAdapter(client=c)
        report = json.loads(a.to_json_report(run(a.scan_domain("example.com", "s1"))))
        self.assertEqual(report["scan_id"], "s1")
        self.assertEqual(set(report["findings"][0]), set(ProvenanceRecord.__dataclass_fields__))
        self.assertEqual(report["summary"]["tools_executed"], 5)


class ConcurrencyTests(unittest.TestCase):
    def test_domain_scan_runs_5_tools_concurrently(self):
        c = FakeClient()
        start = time.monotonic()
        r = run(OpenOSINTAdapter(client=c).scan_domain("example.com", "s1"))
        self.assertEqual(r.tools_executed, 5)
        self.assertEqual(c.max_inflight, 5)
        self.assertLess(time.monotonic() - start, 0.05 * 5)

    def test_concurrent_limit_is_enforced(self):
        c = FakeClient()
        run(OpenOSINTAdapter(client=c, concurrent_limit=2).scan_domain("example.com", "s1"))
        self.assertEqual(c.max_inflight, 2)


class ErrorHandlingTests(unittest.TestCase):
    def test_timeout_is_isolated_and_counted(self):
        async def slow(a):
            await asyncio.sleep(1)
        c = FakeClient({"search_whois": slow, "search_dns": lambda a: out("[DNS] A: 1.2.3.4")})
        r = run(OpenOSINTAdapter(client=c, timeout_seconds=0.2).scan_domain("example.com", "s1"))
        self.assertIn({"tool": "search_whois", "kind": ERROR_TIMEOUT}, r.tool_errors)
        self.assertEqual([f.finding for f in r.findings], ["[DNS] A: 1.2.3.4"])

    def test_error_kinds_from_real_style_output(self):
        c = FakeClient({
            "search_whois": lambda a: out("Scan error: whois key not set.", "[key_required] WHOIS_API_KEY"),
            "search_rdap": lambda a: out("Scan error: HTTP 429 rate limit exceeded"),
            "search_dns": lambda a: (_ for _ in ()).throw(RuntimeError("boom jo@example.com")),
        })
        r = run(OpenOSINTAdapter(client=c).scan_domain("example.com", "s1"))
        self.assertEqual({(e["tool"], e["kind"]) for e in r.tool_errors},
                         {("search_whois", ERROR_API_KEY), ("search_rdap", ERROR_RATE_LIMIT),
                          ("search_dns", ERROR_OTHER)})
        self.assertNotIn("jo@example.com", json.dumps(r.tool_errors))
        self.assertEqual(r.tools_failed, 3)

    def test_unexpected_shape_does_not_fail_scan(self):
        c = FakeClient(default={"nope": 1})
        r = run(OpenOSINTAdapter(client=c).scan_username("someone", "s1"))
        self.assertEqual(r.tools_failed, 2)
        self.assertEqual(r.total_findings, 0)

    def test_server_that_cannot_start_fails_every_tool_not_the_scan(self):
        r = run(OpenOSINTAdapter(client=FakeClient(fail_session=True)).scan_email("jo@example.com", "s1"))
        self.assertEqual(r.tools_failed, 2)
        self.assertNotIn("jo@example.com", json.dumps(r.tool_errors))


class PolicyTests(unittest.TestCase):
    @staticmethod
    async def _call(adapter, client, tool):
        return await adapter._call(client, tool, "x", "s1", asyncio.Semaphore(1))

    def test_noisy_tool_blocked_when_passive_only(self):
        for tool in ("search_email", "search_username", "search_domain"):
            c = FakeClient()
            out_ = run(self._call(OpenOSINTAdapter(client=c), c, tool))
            self.assertIsInstance(out_, ToolError)
            self.assertEqual(out_.kind, ERROR_POLICY)
            self.assertEqual(c.calls, [])

    def test_noisy_tool_allowed_only_with_allow_active_and_flagged(self):
        c = FakeClient({"search_email": lambda a: out("Account found on site")})
        a = OpenOSINTAdapter(client=c, policy=ToolPolicy.ALLOW_ACTIVE)
        recs = run(self._call(a, c, "search_email"))
        self.assertTrue(recs[0].is_active)

    def test_default_plans_are_passive(self):
        for plan in PLANS.values():
            self.assertTrue(set(plan) <= PASSIVE_TOOLS)


class LoggingTests(unittest.TestCase):
    def test_targets_never_logged(self):
        c = FakeClient({"search_github": lambda a: (_ for _ in ()).throw(RuntimeError("x"))},
                       fail_session=False)
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
        except ImportError:
            raise unittest.SkipTest("mcp>=2 SDK with MCPServer not installed")
        s = MCPServer("fake-openosint")
        arg_of = {t: v[0] for t, v in TOOLS.items()}

        def register(name):
            argname = arg_of[name]
            ns = {}
            exec(f"def tool({argname}: str, json_output: bool = False) -> dict:\n"
                 f"    return RESULT({name!r}, {argname})\n", {"RESULT": cls._result}, ns)
            fn = ns["tool"]
            fn.__name__ = name
            s.tool()(fn)
        for name in TOOLS:
            register(name)
        cls.server = s

    @staticmethod
    def _result(tool, target):
        if tool == "search_whois":
            return out("Scan error: WHOIS query failed: [Errno -2] Name or service not known")
        if tool == "search_virustotal":
            return out("Scan error: cannot run: key missing", "[key_required] VIRUSTOTAL_API_KEY")
        return out(f"{tool} saw {target}")

    def test_scan_over_mcp_protocol(self):
        a = OpenOSINTAdapter(client=MCPToolClient(server=self.server))
        self.assertEqual(run(a.missing_tools()), [])
        r = run(a.scan_domain("example.com", "s1"))
        self.assertEqual(r.tools_executed, 5)
        self.assertEqual({(e["tool"], e["kind"]) for e in r.tool_errors},
                         {("search_whois", ERROR_OTHER), ("search_virustotal", ERROR_API_KEY)})
        self.assertEqual({f.tool_name for f in r.findings},
                         {"search_rdap", "search_dns", "search_footprint"})


class SpawnedServerStderrTests(unittest.TestCase):
    """OpenOSINT logs every tool call with its target to stderr; the adapter must not pass that on."""

    FAKE_SERVER = (
        "#!{python}\n"
        "import json, sys\n"
        "from mcp.server.mcpserver import MCPServer\n"
        "s = MCPServer('fake-openosint')\n"
        "@s.tool()\n"
        "def search_dns(domain: str, json_output: bool = False) -> dict:\n"
        "    print('LEAKED-TARGET:' + domain, file=sys.stderr, flush=True)\n"
        "    return {{'tool': 'search_dns', 'target': domain, 'timestamp': 't', 'results': ['[DNS] A: 1.2.3.4'], 'error': None}}\n"
        "s.run(transport='stdio')\n"
    )
    RUNNER = (
        "import asyncio, sys\n"
        "from app.openosint_mcp_adapter import OpenOSINTAdapter\n"
        "r = asyncio.run(OpenOSINTAdapter().scan_domain('secret-domain.example', 's1'))\n"
        "print('FINDINGS', [f.finding for f in r.findings if f.tool_name == 'search_dns'])\n"
    )

    @classmethod
    def setUpClass(cls):
        try:
            import mcp.server.mcpserver  # noqa: F401
        except ImportError:
            raise unittest.SkipTest("mcp>=2 SDK not installed")

    def _run(self, **extra_env):
        import subprocess
        import sys
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            server = Path(d) / "fake-openosint-mcp"
            server.write_text(self.FAKE_SERVER.format(python=sys.executable))
            server.chmod(0o755)
            env = dict(os.environ, OPENOSINT_MCP_COMMAND=str(server), **extra_env)
            env.pop("OPENOSINT_DEBUG_STDERR", None) if "OPENOSINT_DEBUG_STDERR" not in extra_env else None
            return subprocess.run([sys.executable, "-c", self.RUNNER], capture_output=True, text=True,
                                  env=env, cwd=Path(__file__).parent.parent, timeout=60)

    def test_server_stderr_with_the_target_is_not_passed_on(self):
        r = self._run()
        self.assertIn("[DNS] A: 1.2.3.4", r.stdout, r.stderr)  # the scan itself worked
        self.assertNotIn("LEAKED-TARGET", r.stderr)
        self.assertNotIn("secret-domain.example", r.stderr)

    def test_control_debug_flag_does_pass_it_on(self):
        r = self._run(OPENOSINT_DEBUG_STDERR="1")
        self.assertIn("LEAKED-TARGET:secret-domain.example", r.stderr)  # proves the test can see a leak


@unittest.skipUnless(os.getenv("OPENOSINT_MCP_COMMAND"), "set OPENOSINT_MCP_COMMAND to run against a real openosint-mcp")
class LiveServerTests(unittest.TestCase):
    def test_real_server_has_every_tool_the_adapter_uses(self):
        self.assertEqual(run(OpenOSINTAdapter().missing_tools()), [])

    def test_real_domain_scan_returns_dns_provenance(self):
        r = run(OpenOSINTAdapter().scan_domain("example.com", "live"))
        self.assertTrue(any(f.tool_name == "search_dns" for f in r.findings))


if __name__ == "__main__":
    unittest.main()
