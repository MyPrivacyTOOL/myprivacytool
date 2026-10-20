import unittest

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.crypto import signing
from app.models import RiskDetection, Severity
from app.services import risk_detector, scorer


def _det(freq=2):
    return RiskDetection(57, "API keys in logs", "toolUseAndAPI", Severity.HIGH, freq)


class ScorerTests(unittest.TestCase):
    def test_risk57_design_example_is_about_26(self):
        self.assertEqual(scorer.risk_score(2, 45, age_hours=1, exposure_days=1), 26)

    def test_never_wraps_and_bounded_by_baseline(self):
        for freq in (0, 1, 10, 100, 10_000):
            s = scorer.risk_score(freq, 45, exposure_days=7)
            self.assertTrue(0 <= s <= 45)
        self.assertLessEqual(scorer.risk_score(10, 45, exposure_days=7),
                             scorer.risk_score(10_000, 45, exposure_days=7))

    def test_monotone_in_frequency(self):
        vals = [scorer.risk_score(f, 45) for f in range(0, 30)]
        self.assertEqual(vals, sorted(vals))

    def test_incomplete_audit_never_approved(self):
        _, _, status = scorer.score_all([], audit_complete=False)
        self.assertEqual(status, "INCOMPLETE")
        _, _, status = scorer.score_all([], audit_complete=True)
        self.assertEqual(status, "APPROVED_FOR_P1_DATA")


class DetectorTests(unittest.TestCase):
    def test_exception_marks_incomplete_not_clean(self):
        def boom():
            raise RuntimeError("bigquery down")
        out = risk_detector.run_audit([("r57", boom), ("r9", lambda: None)])
        self.assertFalse(out.complete)
        self.assertEqual(out.errors[0].detector, "r57")
        self.assertEqual(out.detections, [])

    def test_clean_run_is_complete(self):
        out = risk_detector.run_audit([("r57", lambda: _det())])
        self.assertTrue(out.complete)
        self.assertEqual(len(out.detections), 1)


class SigningTests(unittest.TestCase):
    def setUp(self):
        key = Ed25519PrivateKey.generate()  # test-only, in memory, never persisted
        self.priv = key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
                                      serialization.NoEncryption())
        self.pub = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        self.signer = signing.PassportSigner(self.priv, "urn:shadow-audit:key:test#1")
        self.doc = signing.build_passport("agent-1", 81, "APPROVED_FOR_P1_DATA",
                                          "2026-10-19T00:00:00Z", "2027-10-19T00:00:00Z", "staging")

    def test_roundtrip_and_key_order_independence(self):
        signed = self.signer.sign(self.doc, "2026-10-19T00:00:00Z")
        self.assertTrue(signing.verify(signed, self.pub))
        reordered = dict(reversed(list(signed.items())))
        self.assertTrue(signing.verify(reordered, self.pub))

    def test_tamper_detected(self):
        signed = self.signer.sign(self.doc, "2026-10-19T00:00:00Z")
        signed["credentialSubject"]["overallScore"] = 99
        self.assertFalse(signing.verify(signed, self.pub))

    def test_environment_is_signed(self):
        signed = self.signer.sign(self.doc, "2026-10-19T00:00:00Z")
        signed["credentialSubject"]["environment"] = "production"
        self.assertFalse(signing.verify(signed, self.pub))

    def test_proof_options_are_bound(self):
        signed = self.signer.sign(self.doc, "2026-10-19T00:00:00Z")
        signed["proof"]["created"] = "2030-01-01T00:00:00Z"
        self.assertFalse(signing.verify(signed, self.pub))


if __name__ == "__main__":
    unittest.main()
