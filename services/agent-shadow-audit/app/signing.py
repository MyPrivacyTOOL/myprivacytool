"""Ed25519 signing for audit receipts.

The private key is a raw 32-byte seed, base64url-encoded, stored in GCP Secret
Manager. It is read once at startup and never logged or returned.
"""
import base64
import hashlib
import json
import os

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def b64u_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def canonical(obj) -> bytes:
    """Deterministic JSON bytes: sorted keys, no whitespace, UTF-8."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


class Signer:
    def __init__(self, seed: bytes):
        if len(seed) != 32:
            raise ValueError("Ed25519 seed must be 32 bytes")
        self._key = Ed25519PrivateKey.from_private_bytes(seed)
        pub = self._key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        self.public_key_b64u = b64u(pub)
        self.kid = b64u(hashlib.sha256(pub).digest()[:12])

    def sign(self, payload: dict) -> dict:
        sig = self._key.sign(canonical(payload))
        return {"payload": payload, "alg": "EdDSA", "kid": self.kid, "signature": b64u(sig)}

    def jwks(self) -> dict:
        return {"keys": [{"kty": "OKP", "crv": "Ed25519", "kid": self.kid,
                          "alg": "EdDSA", "use": "sig", "x": self.public_key_b64u}]}


def load_signer() -> Signer:
    """Secret Manager in production; env var only for local development."""
    name = os.environ.get("SIGNING_KEY_SECRET")  # projects/P/secrets/S/versions/latest
    if name:
        from google.cloud import secretmanager  # imported lazily; not needed in tests

        client = secretmanager.SecretManagerServiceClient()
        value = client.access_secret_version(name=name).payload.data.decode().strip()
    else:
        value = os.environ.get("SIGNING_KEY_B64U_DEV")
        if not value:
            raise RuntimeError("Set SIGNING_KEY_SECRET (production) or SIGNING_KEY_B64U_DEV (local only)")
    return Signer(b64u_decode(value))
