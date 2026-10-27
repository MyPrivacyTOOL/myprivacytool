"""MPC-8644: finished, scored audits are pushed to the producer Worker; nothing else leaks."""
import json
import unittest

from app.config import Settings
from app.integrations.outbound import QueuePublisher
from app.integrations.sources import InMemorySource
from tests.test_phase2 import Boom, CLEAN, SECRET, svc


def pub():
    calls = []
    return calls, QueuePublisher("https://q.example/enqueue", "s3cret", lambda m, u, h, b: calls.append((u, h, b)) or {})


class QueuePublishTests(unittest.TestCase):
    def test_scored_audit_is_pushed_with_allowlisted_fields_only(self):
        calls, q = pub()
        r = svc(InMemorySource({"a1": CLEAN}), queue=q).run("a1")
        self.assertEqual(len(calls), 1)
        url, headers, body = calls[0]
        self.assertEqual(url, "https://q.example/enqueue")
        self.assertEqual(headers["Authorization"], "Bearer s3cret")
        self.assertEqual(sorted(body), ["audit_id", "created_at", "env", "outcome", "pillar_scores"])
        self.assertEqual((body["audit_id"], body["outcome"], body["env"]), (r["auditId"], "pass", "staging"))
        self.assertTrue(all(isinstance(v, (int, float)) and 0 <= v <= 100 for v in body["pillar_scores"].values()))
        self.assertTrue(all(k == k.lower() and k.replace("_", "").isalnum() for k in body["pillar_scores"]))
        self.assertNotIn("a1", json.dumps(body))  # agent id never leaves

    def test_quarantine_maps_to_fail_and_leaks_no_evidence(self):
        calls, q = pub()
        r = svc(InMemorySource({"a1": CLEAN + [{"ts": "2026-10-20T00:00:09Z", "text": f"key={SECRET}"}]}), queue=q).run("a1")
        self.assertEqual(r["riskLevel"], "QUARANTINE")
        self.assertEqual(calls[0][2]["outcome"], "fail")
        self.assertNotIn(SECRET, json.dumps(calls[0][2]))

    def test_incomplete_audit_is_not_pushed(self):
        calls, q = pub()
        r = svc(Boom(), queue=q).run("a1")
        self.assertEqual((r["riskLevel"], calls), ("INCOMPLETE", []))

    def test_queue_failure_does_not_lose_the_audit(self):
        def boom(m, u, h, b):
            raise OSError("down")
        r = svc(InMemorySource({"a1": CLEAN}), queue=QueuePublisher("https://q.example/enqueue", "x", boom)).run("a1")
        self.assertEqual(r["status"], "completed")
        self.assertTrue(any(e.startswith("queue:") for e in r["errors"]))
        self.assertNotIn("x", "".join(e for e in r["errors"] if "Bearer" in e))

    def test_disabled_without_https_endpoint_or_secret(self):
        self.assertFalse(Settings(queue_endpoint="http://q", queue_secret="s").queue_enabled)
        self.assertFalse(Settings(queue_endpoint="https://q", queue_secret="").queue_enabled)
        self.assertTrue(Settings(queue_endpoint="https://q", queue_secret="s").queue_enabled)

    def test_production_env_maps_to_prod(self):
        calls, q = pub()
        svc(InMemorySource({"a1": CLEAN}), queue=q, env="production").run("a1")
        self.assertEqual(calls[0][2]["env"], "prod")
