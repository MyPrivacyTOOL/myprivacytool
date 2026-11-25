"""MPC-11203: exposure API routes (FastAPI). Skipped where fastapi is not installed."""
import time
import unittest

try:
    from fastapi.testclient import TestClient
except ImportError:  # pragma: no cover
    raise unittest.SkipTest("fastapi/httpx not installed")

from app.exposure_app import app
from app.routes import exposure
from tests.test_openosint_adapter import FakeClient, out
from app.openosint_mcp_adapter import OpenOSINTAdapter


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self._adapter = exposure.adapter
        exposure.adapter = OpenOSINTAdapter(client=FakeClient({
            "search_dns": lambda a: out("[DNS] A: 1.2.3.4"),
            "search_whois": lambda a: out("Scan error: WHOIS query failed"),
        }))
        exposure._scan_cache.clear()

    def tearDown(self):
        exposure.adapter = self._adapter

    def _wait(self, scan_id):
        for _ in range(50):
            body = self.client.get(f"/api/v1/scans/{scan_id}").json()
            if body["summary"].get("tools_executed"):
                return body
            time.sleep(0.05)
        self.fail("scan did not finish")

    def test_domain_scan_end_to_end(self):
        r = self.client.post("/api/v1/scans/domain", json={"domain": "example.com"})
        self.assertEqual(r.status_code, 200)
        body = self._wait(r.json()["scan_id"])
        self.assertEqual([f["finding"] for f in body["findings"]], ["[DNS] A: 1.2.3.4"])
        self.assertEqual(body["findings"][0]["data_source"], "dns resolver")
        self.assertIn({"tool": "search_whois", "kind": "error"}, body["summary"]["tool_errors"])

    def test_email_and_username_scans_accepted(self):
        self.assertEqual(self.client.post("/api/v1/scans/email", json={"email": "a@example.com"}).status_code, 200)
        self.assertEqual(self.client.post("/api/v1/scans/username", json={"username": "someone"}).status_code, 200)

    def test_validation(self):
        self.assertEqual(self.client.post("/api/v1/scans/email", json={"email": "not-an-email"}).status_code, 422)
        self.assertEqual(self.client.post("/api/v1/scans/domain", json={"domain": "a.com", "priority": "bogus"}).status_code, 422)

    def test_unknown_scan_is_404_and_health_ok(self):
        self.assertEqual(self.client.get("/api/v1/scans/nope").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/health").json()["status"], "healthy")


if __name__ == "__main__":
    unittest.main()
