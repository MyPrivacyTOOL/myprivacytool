"""Ed25519 passport signing. Fixes MPC-7877 issue 3: sign a *canonicalized*
document bound to its proof options, not plain sorted JSON.

Canonicalization here is RFC 8785 (JCS) over a self-contained JSON-LD document
(inline @context, no remote loading). Swapping in URDNA2015 (pyld) is a
follow-up once that dependency can be installed; the interface stays the same.
Private keys are NEVER created or stored by this module: callers pass key bytes
that were loaded from Secret Manager at runtime."""
import base64
import hashlib
import json
from typing import Any, Dict

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

PASSPORT_CONTEXT = {
    "VerifiableCredential": "https://www.w3.org/2018/credentials#VerifiableCredential",
    "AgentAuditPassport": "urn:shadow-audit:AgentAuditPassport",
    "overallScore": "urn:shadow-audit:overallScore",
    "riskLevel": "urn:shadow-audit:riskLevel",
    "environment": "urn:shadow-audit:environment",
}


def canonicalize(doc: Dict[str, Any]) -> bytes:
    """JCS: sorted keys, no whitespace, UTF-8 (ensure_ascii off)."""
    return json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")


def _signing_input(doc: Dict[str, Any], proof_options: Dict[str, Any]) -> bytes:
    unsigned = {k: v for k, v in doc.items() if k != "proof"}
    # Hash(proof options) || Hash(document), as in Data Integrity proofs.
    return hashlib.sha256(canonicalize(proof_options)).digest() + hashlib.sha256(canonicalize(unsigned)).digest()


class PassportSigner:
    def __init__(self, private_key_bytes: bytes, verification_method: str):
        self._key = Ed25519PrivateKey.from_private_bytes(private_key_bytes)
        self.verification_method = verification_method

    def sign(self, doc: Dict[str, Any], created: str) -> Dict[str, Any]:
        opts = {"type": "Ed25519Signature2020", "created": created,
                "verificationMethod": self.verification_method, "proofPurpose": "assertionMethod"}
        sig = self._key.sign(_signing_input(doc, opts))
        signed = {k: v for k, v in doc.items() if k != "proof"}
        signed["proof"] = {**opts, "proofValue": base64.urlsafe_b64encode(sig).decode()}
        return signed


def verify(doc: Dict[str, Any], public_key_bytes: bytes) -> bool:
    proof = doc.get("proof")
    if not proof or "proofValue" not in proof:
        return False
    opts = {k: v for k, v in proof.items() if k != "proofValue"}
    try:
        Ed25519PublicKey.from_public_bytes(public_key_bytes).verify(
            base64.urlsafe_b64decode(proof["proofValue"]), _signing_input(doc, opts))
        return True
    except (InvalidSignature, ValueError):
        return False


def build_passport(agent_id: str, overall_score: int, risk_level: str, issued: str,
                   expires: str, environment: str) -> Dict[str, Any]:
    """environment='staging' passports are tests and must not be trusted by production."""
    return {
        "@context": ["https://www.w3.org/2018/credentials/v1", PASSPORT_CONTEXT],
        "type": ["VerifiableCredential", "AgentAuditPassport"],
        "issuer": "urn:shadow-audit-gatekeeper",
        "issuanceDate": issued,
        "expirationDate": expires,
        "credentialSubject": {"id": agent_id, "overallScore": overall_score,
                              "riskLevel": risk_level, "environment": environment},
    }
