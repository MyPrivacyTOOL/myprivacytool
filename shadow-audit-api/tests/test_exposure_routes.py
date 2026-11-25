"""MPC-11203: exposure API routes (FastAPI) and their bearer auth. Skipped where fastapi is absent."""
import os
import time
import unittest
from unittest import mock

try:
    from fastapi.testclient import TestClient
except ImportError:  # pragma: no cover
    raise unittest.SkipTest("fastapi/httpx not installed")

from app.exposure_app import app
from app.routes import exposure
from tests.test_openosint_adapter import FakeClient, out
from app.openosint_mcp_adapter import OpenOSINTAdapter

TOKEN = "unit-test-token-not-a-secret"  # a throwaway value used only in these tests
AUTH = {"Authorization": f"Bearer {TOKEN}"}

PROTECTED = [
    ("POST", "/api/v1/scans/email", {"email": "a@example.com"}),
    ("POST", "/api/v1/scans/username", {"username": "someone"}),
    ("POST", "/api/v1/scans/domain", {"domain": "example.com"}),
    ("GET", "/api/v1/scans/some-id", None),
]


class RouteTestCase(unittest.TestCase):
    def setUp(self):
        env = mock.patch.dict(os.environ, {exposure.TOKEN_ENV: TOKEN})
        env.start()
        self.addCleanup(env.stop)
        self.client = TestClient(app)
        self._adapter = exposure.adapter
        exposure.adapter = OpenOSINTAdapter(client=FakeClient({
            "search_dns": lambda a: out("[DNS] A: 1.2.3.4"),
            "search_whois": lambda a: out("Scan error: WHOIS query failed"),
        }))
        exposure._scan_cache.clear()

    def tearDown(self):
        exposure.adapter = self._adapter

    def call(self, method, path, body, headers=None):
        return self.client.request(method, path, json=body, headers=headers)


class RouteTests(RouteTestCase):
    def _wait(self, scan_id):
        for _ in range(50):
            body = self.client.get(f"/api/v1/scans/{scan_id}", headers=AUTH).json()
            if body["summary"].get("tools_executed"):
                return body
            time.sleep(0.05)
        self.fail("scan did not finish")

    def test_domain_scan_end_to_end(self):
        r = self.client.post("/api/v1/scans/domain", json={"domain": "example.com"}, headers=AUTH)
        self.assertEqual(r.status_code, 200)
        body = self._wait(r.json()["scan_id"])
        self.assertEqual([f["finding"] for f in body["findings"]], ["[DNS] A: 1.2.3.4"])
        self.assertEqual(body["findings"][0]["data_source"], "dns resolver")
        self.assertIn({"tool": "search_whois", "kind": "error"}, body["summary"]["tool_errors"])

    def test_email_and_username_scans_accepted(self):
        self.assertEqual(self.client.post("/api/v1/scans/email", json={"email": "a@example.com"}, headers=AUTH).status_code, 200)
        self.assertEqual(self.client.post("/api/v1/scans/username", json={"username": "someone"}, headers=AUTH).status_code, 200)

    def test_validation(self):
        self.assertEqual(self.client.post("/api/v1/scans/email", json={"email": "not-an-email"}, headers=AUTH).status_code, 422)
        self.assertEqual(self.client.post("/api/v1/scans/domain", json={"domain": "a.com", "priority": "bogus"}, headers=AUTH).status_code, 422)

    def test_unknown_scan_is_404_and_health_ok(self):
        self.assertEqual(self.client.get("/api/v1/scans/nope", headers=AUTH).status_code, 404)
        self.assertEqual(self.client.get("/api/v1/health").json()["status"], "healthy")


class AuthTests(RouteTestCase):
    def test_every_protected_route_rejects_a_missing_header(self):
        for method, path, body in PROTECTED:
            r = self.call(method, path, body)
            self.assertEqual(r.status_code, 401, path)
            self.assertEqual(r.headers.get("www-authenticate"), "Bearer")

    def test_every_protected_route_rejects_a_wrong_token(self):
        for method, path, body in PROTECTED:
            r = self.call(method, path, body, {"Authorization": "Bearer not-the-token"})
            self.assertEqual(r.status_code, 401, path)

    def test_wrong_scheme_empty_and_prefix_tokens_are_rejected(self):
        for bad in (f"Basic {TOKEN}", TOKEN, "Bearer", "Bearer ", f"Bearer {TOKEN}x", f"Bearer {TOKEN[:-1]}"):
            r = self.call("GET", "/api/v1/scans/some-id", None, {"Authorization": bad})
            self.assertEqual(r.status_code, 401, bad)

    def test_non_ascii_token_is_a_401_not_a_crash(self):
        r = self.call("GET", "/api/v1/scans/some-id", None, {"Authorization": "Bearer café".encode("utf-8")})
        self.assertEqual(r.status_code, 401)

    def test_correct_token_is_accepted_and_scheme_is_case_insensitive(self):
        for scheme in ("Bearer", "bearer", "BEARER"):
            r = self.call("GET", "/api/v1/scans/nope", None, {"Authorization": f"{scheme} {TOKEN}"})
            self.assertEqual(r.status_code, 404, scheme)  # past auth, scan not found

    def test_unset_or_empty_token_fails_closed(self):
        for value in (None, ""):
            env = dict(os.environ)
            env.pop(exposure.TOKEN_ENV, None)
            if value is not None:
                env[exposure.TOKEN_ENV] = value
            with mock.patch.dict(os.environ, env, clear=True):
                for method, path, body in PROTECTED:
                    for headers in (None, AUTH, {"Authorization": "Bearer "}):
                        r = self.call(method, path, body, headers)
                        self.assertEqual(r.status_code, 401, (value, path, headers))

    def test_health_stays_open_with_and_without_a_token(self):
        self.assertEqual(self.client.get("/api/v1/health").status_code, 200)
        env = dict(os.environ)
        env.pop(exposure.TOKEN_ENV, None)
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(self.client.get("/api/v1/health").status_code, 200)

    def test_rejection_does_not_echo_the_token_or_log_it(self):
        with self.assertLogs("app.routes.exposure", level="DEBUG") as cm:
            exposure.logger.error("marker")  # assertLogs needs at least one record
            r = self.call("POST", "/api/v1/scans/email", {"email": "jo.smith@example.com"},
                          {"Authorization": "Bearer wrong-secret-value"})
        self.assertEqual(r.status_code, 401)
        self.assertEqual(r.json(), {"detail": "unauthorized"})
        text = r.text + "\n".join(cm.output)
        for secret in ("wrong-secret-value", TOKEN, "jo.smith"):
            self.assertNotIn(secret, text)

    def test_unauthenticated_request_starts_no_scan(self):
        called = []
        exposure.adapter = OpenOSINTAdapter(client=FakeClient({"search_dns": lambda a: called.append(a) or out()}))
        self.call("POST", "/api/v1/scans/domain", {"domain": "example.com"})
        time.sleep(0.2)
        self.assertEqual(called, [])
        self.assertEqual(len(exposure._scan_cache), 0)


if __name__ == "__main__":
    unittest.main()
