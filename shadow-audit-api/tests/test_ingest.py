"""MPC-8364 ingest endpoint + loader push. All values are made up; the BigQuery sink is not exercised here."""
import io
import json
import os
import tempfile
import unittest
from collections import Counter

from app.api import make_app
from app.config import Settings
from app.ingest import IngestError, IngestService, InMemorySink, MAX_ROWS, row_key, validate_rows
from app.ingest_api import make_ingest_app
from app.integrations.sources import InMemorySource
from loader import audit_log_loader as L
from tests.test_phase2 import SECRET, svc

TOKEN = "t" * 64
URL = "https://ingest.example.test"


def row(i=0, agent="testingnt69", **kw):
    r = {"ts": f"2026-10-22T10:00:{i:02d}.000Z", "text": f"tool web_search completed: ok {i}", "tool": "web_search",
         "session": "c1", "vault_start": [], "vault_end": [], "agent_id": agent, "nonce": None, "sender": None, "dest_region": None}
    r.update(kw)
    return r


def call(app, method, path, body=None, token=TOKEN, raw=None, headers=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else b"")
    env = {"REQUEST_METHOD": method, "PATH_INFO": path, "CONTENT_LENGTH": str(len(data)), "wsgi.input": io.BytesIO(data)}
    if token is not None:
        env["HTTP_X_API_TOKEN"] = token
    env.update(headers or {})
    out = {}
    res = app(env, lambda code, h: out.setdefault("code", code))
    return out["code"], json.loads(b"".join(res))


def make(agents=("testingnt69",), sink=None, **kw):
    sink = sink or InMemorySink()
    return make_ingest_app(IngestService(sink, agents), TOKEN, **kw), sink


class ValidationTests(unittest.TestCase):
    def bad(self, rows, agent="testingnt69"):
        with self.assertRaises(IngestError) as c:
            validate_rows(agent, rows)
        self.assertEqual(c.exception.status, 400)
        return c.exception.message

    def test_good_rows_pass_and_are_masked_again(self):
        out = validate_rows("testingnt69", [row(text=f"key={SECRET} mail bob@example.com")])
        self.assertNotIn(SECRET, out[0]["text"])
        self.assertIn("[EMAIL]", out[0]["text"])

    def test_rejections(self):
        self.bad([])
        self.bad("x")
        self.bad([row(i) for i in range(MAX_ROWS + 1)])
        self.bad(["not an object"])
        self.assertIn("unknown field", self.bad([row(extra="x")]))
        self.assertIn("agent_id", self.bad([row(agent="someone-else")]))
        self.assertIn("ts", self.bad([row(ts="yesterday")]))
        self.assertIn("ts", self.bad([row(ts=12345)]))
        self.assertIn("text", self.bad([row(text=5)]))
        self.assertIn("text", self.bad([row(text="x" * 4001)]))
        self.assertIn("tool", self.bad([row(tool="t" * 101)]))
        self.assertIn("vault_start", self.bad([row(vault_start="notalist")]))
        self.assertIn("vault_start", self.bad([row(vault_start=["k"] * 51)]))

    def test_error_messages_never_echo_content(self):
        msg = self.bad([row(text=SECRET, ts="nope")])
        self.assertNotIn(SECRET, msg)
        self.assertIn("row 0", msg)

    def test_naive_timestamp_is_accepted_as_utc(self):
        self.assertEqual(len(validate_rows("testingnt69", [row(ts="2026-10-22T10:00:00")])), 1)


class ServiceTests(unittest.TestCase):
    def test_dedupe_within_and_across_requests(self):
        sink = InMemorySink()
        s = IngestService(sink, ["testingnt69"])
        r1 = s.ingest("testingnt69", [row(0), row(1), row(1)])        # one repeat inside the batch
        self.assertEqual(r1, {"received": 3, "inserted": 2, "duplicates": 1})
        r2 = s.ingest("testingnt69", [row(0), row(1), row(2)])         # same window again plus one new
        self.assertEqual(r2, {"received": 3, "inserted": 1, "duplicates": 2})
        self.assertEqual(len(sink.rows), 3)

    def test_same_instant_but_different_events_are_both_kept(self):
        s = IngestService(InMemorySink(), ["testingnt69"])
        r = s.ingest("testingnt69", [row(0, text="a"), row(0, text="b"), row(0, tool="shell")])
        self.assertEqual(r["inserted"], 3)

    def test_key_ignores_timestamp_format_differences(self):
        from datetime import datetime, timezone
        a = row_key("x", "2026-10-22T10:00:00.123Z", "t", "s", "hi")
        b = row_key("x", datetime(2026, 10, 22, 10, 0, 0, 123456, tzinfo=timezone.utc), "t", "s", "hi")
        self.assertEqual(a, b)

    def test_allowlist_and_agent_id_format(self):
        s = IngestService(InMemorySink(), ["testingnt69"])
        with self.assertRaises(IngestError) as c:
            s.ingest("myprivacytool", [row(agent="myprivacytool")])
        self.assertEqual(c.exception.status, 403)
        with self.assertRaises(IngestError) as c:
            s.ingest("Bad Agent!", [row()])
        self.assertEqual(c.exception.status, 400)
        with self.assertRaises(IngestError) as c:
            IngestService(InMemorySink(), []).ingest("testingnt69", [row()])
        self.assertEqual(c.exception.status, 403)           # empty allowlist allows nothing

    def test_sink_failures_are_errors_not_silent_success(self):
        class Down(InMemorySink):
            def existing_keys(self, *a): raise RuntimeError("bq down")
        class NoWrite(InMemorySink):
            def append(self, rows): raise RuntimeError("write failed")
        for sink in (Down(), NoWrite()):
            with self.assertRaises(IngestError) as c:
                IngestService(sink, ["testingnt69"]).ingest("testingnt69", [row()])
            self.assertEqual(c.exception.status, 502)


class ApiTests(unittest.TestCase):
    def test_health_is_open_and_names_the_mode(self):
        app, _ = make()
        code, body = call(app, "GET", "/health", token=None)
        self.assertEqual((code, body["mode"]), ("200 OK", "ingest"))

    def test_token_required_and_checked_before_the_body(self):
        app, sink = make()
        for tok in (None, "", "wrong", TOKEN[:-1]):
            self.assertEqual(call(app, "POST", "/ingest/testingnt69", {"rows": [row()]}, token=tok)[0], "401 Unauthorized")
        self.assertEqual(call(app, "POST", "/ingest/testingnt69", raw=b"{not json", token="wrong")[0], "401 Unauthorized")
        self.assertEqual(sink.rows, [])

    def test_bearer_header_also_works(self):
        app, _ = make()
        code, _ = call(app, "POST", "/ingest/testingnt69", {"rows": [row()]}, token=None,
                       headers={"HTTP_AUTHORIZATION": f"Bearer {TOKEN}"})
        self.assertEqual(code, "200 OK")

    def test_no_token_configured_denies_everything(self):
        app = make_ingest_app(IngestService(InMemorySink(), ["testingnt69"]), "")
        self.assertEqual(call(app, "POST", "/ingest/testingnt69", {"rows": [row()]}, token="")[0], "401 Unauthorized")

    def test_happy_path_and_replay(self):
        app, sink = make()
        self.assertEqual(call(app, "POST", "/ingest/testingnt69", {"rows": [row(0), row(1)]})[1],
                         {"received": 2, "inserted": 2, "duplicates": 0})
        self.assertEqual(call(app, "POST", "/ingest/testingnt69", {"rows": [row(0), row(1)]})[1],
                         {"received": 2, "inserted": 0, "duplicates": 2})
        self.assertEqual(len(sink.rows), 2)

    def test_raw_secret_in_a_row_is_masked_before_it_is_stored(self):
        app, sink = make()
        call(app, "POST", "/ingest/testingnt69", {"rows": [row(text=f"password: hunter2 {SECRET}")]})
        self.assertNotIn("hunter2", json.dumps(sink.rows))
        self.assertNotIn(SECRET, json.dumps(sink.rows))

    def test_error_statuses(self):
        app, _ = make()
        self.assertEqual(call(app, "POST", "/ingest/testingnt69", raw=b"{bad")[0], "400 Bad Request")
        self.assertEqual(call(app, "POST", "/ingest/testingnt69", raw=b"[]")[0], "400 Bad Request")
        self.assertEqual(call(app, "POST", "/ingest/testingnt69", {"rows": []})[0], "400 Bad Request")
        self.assertEqual(call(app, "POST", "/ingest/testingnt69", raw=b"")[0], "400 Bad Request")
        self.assertEqual(call(app, "POST", "/ingest/otheragent", {"rows": [row(agent="otheragent")]})[0], "403 Forbidden")
        self.assertEqual(call(app, "POST", "/ingest/testingnt69", {"rows": [row(agent="x")]})[0], "400 Bad Request")

    def test_oversized_body_is_refused_without_reading_it(self):
        app, sink = make(max_body=200)
        self.assertEqual(call(app, "POST", "/ingest/testingnt69", {"rows": [row(i) for i in range(10)]})[0], "413 Payload Too Large")
        self.assertEqual(sink.rows, [])

    def test_unknown_routes_and_methods(self):
        app, _ = make()
        self.assertEqual(call(app, "GET", "/ingest/testingnt69")[0], "404 Not Found")
        self.assertEqual(call(app, "POST", "/audit/testingnt69", {})[0], "404 Not Found")
        self.assertEqual(call(app, "GET", "/.well-known/shadow-audit-keys.json", token=None)[0], "404 Not Found")

    def test_audit_service_has_no_ingest_route(self):
        audit_app = make_app(svc(InMemorySource({})), "tok")
        env = {"REQUEST_METHOD": "POST", "PATH_INFO": "/ingest/testingnt69", "CONTENT_LENGTH": "2",
               "wsgi.input": io.BytesIO(b"{}"), "HTTP_AUTHORIZATION": "Bearer tok"}
        out = {}
        audit_app(env, lambda code, h: out.setdefault("code", code))
        self.assertEqual(out["code"], "404 Not Found")


class SettingsTests(unittest.TestCase):
    def test_env_parsing(self):
        old = {k: os.environ.get(k) for k in ("SERVICE_MODE", "INGEST_AGENTS", "INGEST_TOKEN")}
        try:
            os.environ.update(SERVICE_MODE="ingest", INGEST_AGENTS=" testingnt69, ballsandbikes ,", INGEST_TOKEN="abc")
            s = Settings.from_env()
            self.assertEqual((s.service_mode, s.ingest_agents, s.ingest_token), ("ingest", ("testingnt69", "ballsandbikes"), "abc"))
            os.environ["SERVICE_MODE"] = "nonsense"
            with self.assertRaises(ValueError):
                Settings.from_env()
        finally:
            for k, v in old.items():
                os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)

    def test_defaults_are_audit_mode_and_no_agents(self):
        s = Settings()
        self.assertEqual((s.service_mode, s.ingest_agents, s.ingest_token), ("audit", (), ""))


class PushClientTests(unittest.TestCase):
    def fake(self, fail_on=None):
        calls = []
        def post(url, token, payload):
            if fail_on is not None and len(calls) == fail_on:
                raise OSError("network down")
            calls.append((url, token, len(payload["rows"])))
            return {"received": len(payload["rows"]), "inserted": len(payload["rows"]), "duplicates": 0}
        return calls, post

    def test_batches_and_totals(self):
        calls, post = self.fake()
        out = L.push_rows(URL, "testingnt69", [row(i % 60) for i in range(1100)], TOKEN, batch_size=500, post=post)
        self.assertEqual([c[2] for c in calls], [500, 500, 100])
        self.assertEqual(out["received"], 1100)
        self.assertEqual(calls[0][0], URL + "/ingest/testingnt69")

    def test_https_and_token_are_required(self):
        _, post = self.fake()
        with self.assertRaises(ValueError):
            L.push_rows("http://x.test", "a", [row()], TOKEN, post=post)
        with self.assertRaises(ValueError):
            L.push_rows(URL, "a", [row()], "", post=post)

    def test_token_never_goes_in_the_url(self):
        calls, post = self.fake()
        L.push_rows(URL, "testingnt69", [row()], TOKEN, post=post)
        self.assertNotIn(TOKEN, calls[0][0])

    def test_failure_raises_after_partial_progress(self):
        calls, post = self.fake(fail_on=1)
        with self.assertRaises(OSError):
            L.push_rows(URL, "testingnt69", [row(i % 60) for i in range(1100)], TOKEN, batch_size=500, post=post)
        self.assertEqual(len(calls), 1)

    def test_token_sources(self):
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "tok")
            open(p, "w").write(TOKEN + "\n")
            self.assertEqual(L.read_token(p), TOKEN)
        old = os.environ.get("SHADOW_INGEST_TOKEN")
        os.environ["SHADOW_INGEST_TOKEN"] = " envtok "
        try:
            self.assertEqual(L.read_token(None), "envtok")
        finally:
            os.environ.pop("SHADOW_INGEST_TOKEN") if old is None else os.environ.__setitem__("SHADOW_INGEST_TOKEN", old)

    def test_state_overlap_and_atomic_write(self):
        self.assertEqual(L.overlap_start("2026-10-22T10:00:07.250Z"), "2026-10-22T10:00:02.250Z")
        self.assertEqual(L.overlap_start("2026-10-22T10:00:02.000Z"), "2026-10-22T09:59:57.000Z")
        with tempfile.TemporaryDirectory() as d:
            p = os.path.join(d, "state.json")
            self.assertIsNone(L.read_state(p))
            L.write_state(p, "2026-10-22T10:00:00.000Z")
            self.assertEqual(L.read_state(p), "2026-10-22T10:00:00.000Z")
            self.assertEqual(os.listdir(d), ["state.json"])


class CliPushTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        recs = [{"timestamp": f"2026-10-22T10:00:{i * 10:02d}.000Z", "event_type": "tool_execution_started", "actor_type": "agent",
                 "actor_id": "testingnt69", "target_type": "tool", "target_id": "web_search", "correlation_id": "c1",
                 "details": {"param_keys": ["q"]}} for i in range(3)]
        with open(os.path.join(self.dir, "audit-2026-10-22.jsonl"), "w") as f:
            f.write("\n".join(json.dumps(r) for r in recs) + "\n")
        self.state = os.path.join(self.dir, "state.json")
        self.token = os.path.join(self.dir, "tok")
        open(self.token, "w").write(TOKEN)

    def tearDown(self):
        self.tmp.cleanup()

    def run_cli(self, *args, post=None):
        import contextlib
        out, err = io.StringIO(), io.StringIO()
        original = L._http_post
        if post:
            L._http_post = post
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                try:
                    code = L.main(["--agent", "testingnt69", "--audit-dir", self.dir, *args])
                except SystemExit as e:
                    code = e.code
        finally:
            L._http_post = original
        return code, out.getvalue(), err.getvalue()

    def ok_post(self, sent):
        def post(url, token, payload, timeout=60):
            sent.extend(payload["rows"])
            return {"received": len(payload["rows"]), "inserted": len(payload["rows"]), "duplicates": 0}
        return post

    def test_push_then_incremental_second_run_with_overlap(self):
        sent = []
        code, out, _ = self.run_cli("--push", URL, "--token-file", self.token, "--state-file", self.state, post=self.ok_post(sent))
        self.assertEqual((code, len(sent)), (0, 3))
        self.assertIn("pushed: received 3, inserted 3", out)
        self.assertEqual(L.read_state(self.state), "2026-10-22T10:00:15.000Z")     # newest (10:00:20) minus 5 seconds
        sent2 = []
        self.run_cli("--push", URL, "--token-file", self.token, "--state-file", self.state, post=self.ok_post(sent2))
        self.assertEqual([r["ts"] for r in sent2], ["2026-10-22T10:00:20.000Z"])    # only rows after the overlap point

    def test_failed_push_exits_nonzero_and_leaves_state_alone(self):
        def down(url, token, payload, timeout=60):
            raise OSError("network down")
        code, _, err = self.run_cli("--push", URL, "--token-file", self.token, "--state-file", self.state, post=down)
        self.assertEqual(code, 1)
        self.assertIn("push FAILED", err)
        self.assertNotIn(TOKEN, err)
        self.assertFalse(os.path.exists(self.state))

    def test_dry_run_never_sends(self):
        sent = []
        code, out, _ = self.run_cli("--push", URL, "--token-file", self.token, "--dry-run", post=self.ok_post(sent))
        self.assertEqual((code, sent), (0, []))
        self.assertIn("rows: 3", out)

    def test_http_url_is_refused(self):
        code, _, err = self.run_cli("--push", "http://plain.test", "--token-file", self.token)
        self.assertEqual(code, 1)
        self.assertIn("https", err)

    def test_state_file_needs_push(self):
        code, _, _ = self.run_cli("--out", os.path.join(self.dir, "o.ndjson"), "--state-file", self.state)
        self.assertNotEqual(code, 0)

    def test_nothing_new_is_not_an_error(self):
        sent = []
        self.run_cli("--push", URL, "--token-file", self.token, "--state-file", self.state, "--since", "2026-10-23T00:00:00Z", post=self.ok_post(sent))
        code, out, _ = self.run_cli("--push", URL, "--token-file", self.token, "--since", "2026-10-23T00:00:00Z", post=self.ok_post(sent))
        self.assertEqual((code, sent), (0, []))
        self.assertIn("nothing new", out)


class EndToEndTests(unittest.TestCase):
    def test_pushed_rows_give_the_same_audit_as_reading_them_directly(self):
        recs = [{"timestamp": f"2026-10-22T10:00:0{i}.000Z", "event_type": "tool_execution_failed", "actor_type": "agent",
                 "actor_id": "testingnt69", "target_type": "tool", "target_id": "shell", "correlation_id": "c1",
                 "details": {"error": f"Traceback (most recent call last): key={SECRET}"}} for i in range(2)]
        rows = [L.to_row(r) for r in recs]
        app, sink = make()
        self.assertEqual(call(app, "POST", "/ingest/testingnt69", {"rows": rows})[1]["inserted"], 2)
        direct = svc(InMemorySource({"testingnt69": rows})).run("testingnt69")
        via = svc(InMemorySource({"testingnt69": sink.rows})).run("testingnt69")
        self.assertEqual((via["riskLevel"], sorted(d["riskId"] for d in via["detectedRisks"])),
                         (direct["riskLevel"], sorted(d["riskId"] for d in direct["detectedRisks"])))
        self.assertEqual(via["riskLevel"], "QUARANTINE")
        self.assertNotIn(SECRET, json.dumps(sink.rows))


if __name__ == "__main__":
    unittest.main()
