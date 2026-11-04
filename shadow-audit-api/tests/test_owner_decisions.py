"""MPC-7877 follow-ups after the staging deploy: quarantine rule, public key, build file, log columns."""
import base64
import json
import pathlib
import unittest

from app.api import make_app
from app.config import Settings
from app.crypto import signing
from app.integrations import sources
from app.integrations.outbound import NotionClient
from app.integrations.sources import InMemorySource
from app.services import scorer
from app.services.audit import AuditService
from tests.test_phase2 import PRIV, SECRET, call, svc

ROOT = pathlib.Path(__file__).resolve().parent.parent


class QuarantineRuleTests(unittest.TestCase):
    def test_high_detection_quarantines_even_with_a_high_average_score(self):
        r = svc(InMemorySource({"a1": [{"ts": "t", "text": f"key={SECRET}"}]})).run("a1")
        self.assertEqual(r["detectedRisks"][0]["severity"], "HIGH")
        self.assertGreaterEqual(r["overallScore"], 50)          # the average alone would have approved it
        self.assertEqual(r["riskLevel"], "QUARANTINE")
        self.assertTrue(r["passportIssued"])                    # a quarantine passport is still signed
        self.assertEqual(r["passport"]["credentialSubject"]["riskLevel"], "QUARANTINE")

    def test_critical_detection_quarantines(self):
        e = [{"ts": "1", "tool": "bash", "text": "ls; rm -rf /tmp/x"}]
        self.assertEqual(svc(InMemorySource({"a1": e})).run("a1")["riskLevel"], "QUARANTINE")

    def test_medium_only_is_still_approved(self):
        e = [{"ts": "1", "text": "pip install requests"}]
        r = svc(InMemorySource({"a1": e})).run("a1")
        self.assertEqual([d["severity"] for d in r["detectedRisks"]], ["MEDIUM"])
        self.assertEqual(r["riskLevel"], "APPROVED_FOR_P1_DATA")

    def test_clean_is_approved_and_incomplete_is_still_incomplete(self):
        self.assertEqual(scorer.score_all([], True)[2], "APPROVED_FOR_P1_DATA")
        self.assertEqual(scorer.score_all([], False)[2], "INCOMPLETE")

    def test_notion_row_carries_quarantine_status(self):
        calls = []
        t = lambda m, u, h, b: calls.append(b) or {"url": "https://notion/x"}  # noqa: E731
        svc(InMemorySource({"a1": [{"ts": "t", "text": SECRET}]}), NotionClient("t", "db", t)).run("a1")
        self.assertEqual(calls[0]["properties"]["Status"]["select"]["name"], "QUARANTINE")


class PublicKeyTests(unittest.TestCase):
    def test_published_key_verifies_a_passport_and_rejects_tampering(self):
        s = svc(InMemorySource({"a1": [{"ts": "2026-10-20T00:00:00Z", "text": "ok"}]}))
        app = make_app(s, "tok")
        code, jwks = call(app, "GET", "/.well-known/shadow-audit-keys.json", token=None)   # no API token needed
        self.assertEqual(code, "200 OK")
        key = jwks["keys"][0]
        self.assertEqual((key["kty"], key["crv"], key["kid"]), ("OKP", "Ed25519", "urn:t#1"))
        pub = base64.urlsafe_b64decode(key["x"] + "=" * (-len(key["x"]) % 4))
        passport = s.run("a1")["passport"]
        self.assertEqual(passport["proof"]["verificationMethod"], key["kid"])
        self.assertTrue(signing.verify(passport, pub))
        passport["credentialSubject"]["riskLevel"] = "APPROVED_FOR_P1_DATA-FORGED"
        self.assertFalse(signing.verify(passport, pub))

    def test_never_exposes_private_bytes(self):
        body = json.dumps(svc(InMemorySource({})).signer.jwks())
        self.assertNotIn(base64.urlsafe_b64encode(PRIV).decode().rstrip("="), body)
        self.assertNotIn('"d"', body)

    def test_no_signer_gives_404(self):
        app = make_app(AuditService(Settings(), InMemorySource({}), None), "tok")
        self.assertEqual(call(app, "GET", "/.well-known/shadow-audit-keys.json", token=None)[0], "404 Not Found")


class DetectorDataPathTests(unittest.TestCase):
    def test_replay_and_region_detectors_fire_through_the_audit(self):
        e = [{"ts": "1", "sender": "a", "nonce": "n1"}, {"ts": "2", "sender": "a", "nonce": "n1"},
             {"ts": "3", "dest_region": "us-east1"}]
        ids = {d["riskId"] for d in svc(InMemorySource({"a1": e})).run("a1")["detectedRisks"]}
        self.assertEqual(ids, {65, 119})

    def test_bigquery_query_selects_the_columns_those_detectors_read(self):
        for col in ("nonce", "sender", "dest_region", "vault_start", "vault_end"):
            self.assertIn(col, sources.QUERY_COLUMNS)


class BuildFileTests(unittest.TestCase):
    def test_cloudbuild_uses_build_id_not_short_sha(self):
        text = (ROOT / "cloudbuild.yaml").read_text()
        self.assertNotIn("SHORT_SHA", text)       # empty for manual `gcloud builds submit`
        self.assertEqual(text.count("$BUILD_ID"), 3)


if __name__ == "__main__":
    unittest.main()
