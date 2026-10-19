import asyncio
import json
import unittest

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from app.main import create_app
from app.passports import InMemoryPassportStore, Passport
from app.signing import Signer, b64u_decode, canonical

SEED = bytes(range(32))  # test-only key


async def call(app, method, path, body=None):
    raw = json.dumps(body).encode() if body is not None else b""
    sent, out = False, {}

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": raw, "more_body": False}

    async def send(m):
        if m["type"] == "http.response.start":
            out["status"] = m["status"]
        elif m["type"] == "http.response.body":
            out["body"] = out.get("body", b"") + m.get("body", b"")

    await app({"type": "http", "method": method, "path": path, "raw_path": path.encode(), "query_string": b"",
               "headers": [(b"content-type", b"application/json")], "scheme": "http",
               "server": ("t", 80), "client": ("c", 1), "http_version": "1.1", "root_path": ""}, receive, send)
    return out["status"], json.loads(out["body"])


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.signer = Signer(SEED)
        store = InMemoryPassportStore([
            Passport("a1", "Agent One", ["mail.read"], ["api.example.com"]),
            Passport("r1", "Revoked", [], [], status="revoked")])
        self.app = create_app(self.signer, store)

    def post(self, body):
        return asyncio.run(call(self.app, "POST", "/v1/audit", body))

    def test_clean(self):
        s, r = self.post({"agent_id": "a1", "observed_scopes": ["mail.read"], "observed_hosts": ["api.example.com"]})
        self.assertEqual((s, r["payload"]["verdict"]), (200, "clean"))

    def test_shadow_access_flags_undeclared(self):
        _, r = self.post({"agent_id": "a1", "observed_scopes": ["mail.read", "drive.write"], "observed_hosts": ["evil.test"]})
        codes = {(f["code"], f.get("value")) for f in r["payload"]["findings"]}
        self.assertEqual(r["payload"]["verdict"], "shadow_access")
        self.assertEqual(codes, {("UNDECLARED_SCOPE", "drive.write"), ("UNDECLARED_HOST", "evil.test")})

    def test_unknown_and_revoked(self):
        self.assertEqual(self.post({"agent_id": "nope"})[1]["payload"]["verdict"], "unregistered")
        codes = [f["code"] for f in self.post({"agent_id": "r1"})[1]["payload"]["findings"]]
        self.assertIn("PASSPORT_REVOKED", codes)

    def test_signature_verifies_and_tamper_fails(self):
        _, r = self.post({"agent_id": "a1"})
        pub = Ed25519PublicKey.from_public_bytes(b64u_decode(self.signer.public_key_b64u))
        sig = b64u_decode(r["signature"])
        pub.verify(sig, canonical(r["payload"]))  # raises on failure
        r["payload"]["verdict"] = "clean-ish"
        with self.assertRaises(Exception):
            pub.verify(sig, canonical(r["payload"]))

    def test_jwks_matches_signer(self):
        s, r = asyncio.run(call(self.app, "GET", "/.well-known/agent-shadow-audit-keys.json"))
        self.assertEqual(r["keys"][0]["x"], self.signer.public_key_b64u)
        self.assertEqual(r["keys"][0]["kid"], self.post({"agent_id": "a1"})[1]["kid"])

    def test_bad_input_400(self):
        for body in ({}, {"agent_id": 5}, {"agent_id": "a1", "observed_scopes": "x"}, {"agent_id": "a1", "observed_hosts": [1]}):
            self.assertEqual(self.post(body)[0], 400)

    def test_seed_length_enforced(self):
        with self.assertRaises(ValueError):
            Signer(b"short")


if __name__ == "__main__":
    unittest.main()
