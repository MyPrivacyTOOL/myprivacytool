# MPC-7877 — Signing-key plan (for review; nothing created yet)

Status: PROPOSAL. No key exists. Creating it is one of the five irreversible steps that need individual sign-off.

- **Location:** GCP Secret Manager, secret `shadow-audit-ed25519-key` (raw 32-byte seed, versioned). Separate secrets for staging (`-staging`) and production. Public keys published as `urn:shadow-audit:key:<env>#<n>`.
- **Access:** only the Cloud Run runtime service account holds `secretmanager.secretAccessor` on that one secret. No human or CI principal has accessor. Creation/rotation by an admin role that has no accessor. Data-access audit logs on.
- **Never exported:** the key is loaded into memory at signing time; never written to disk, logs or Notion. The code never generates keys; tests use in-memory throwaways.
- **Rotation:** every 12 months, or on suspicion. New version signs; old public key stays published for verification until the last passport it signed expires (passports last 1 year).
- **Revocation:** publish a revocation list (key id + effective time); verifiers reject proofs from revoked keys created after that time. Compromise: disable the secret version, revoke, re-audit and re-issue.
- **Staging:** separate key, passports carry `environment: "staging"` inside the signed payload, so production verifiers reject them.
