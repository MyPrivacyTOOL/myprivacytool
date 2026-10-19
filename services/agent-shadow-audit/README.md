# Agent Shadow Audit API (MPC-7877)

Compares what an agent was *observed* doing (scopes, hosts) with what its Agent Passport *declares*, and returns an Ed25519-signed receipt. Attestation of observed state, not a guarantee of behaviour.

## Endpoints
| Route | Purpose |
|---|---|
| `POST /v1/audit` | Body `{agent_id, observed_scopes[], observed_hosts[]}` → `{payload, alg:"EdDSA", kid, signature}` |
| `GET /.well-known/agent-shadow-audit-keys.json` | Public key as a JWKS (OKP / Ed25519) for local verification |
| `GET /health` | Liveness |

Verdicts: `clean`, `shadow_access` (undeclared scope/host), `unregistered` (no passport). A revoked passport adds `PASSPORT_REVOKED`.
Signature is over canonical JSON of `payload` (sorted keys, no whitespace, UTF-8); signature and `x` are base64url.

## Configuration
| Env | Meaning |
|---|---|
| `SIGNING_KEY_SECRET` | Secret Manager version, e.g. `projects/P/secrets/shadow-audit-ed25519/versions/latest`. Secret value: 32-byte seed, base64url. |
| `SIGNING_KEY_B64U_DEV` | Local development only. Never set in Cloud Run. |
| `NOTION_TOKEN`, `NOTION_PASSPORT_DB` | Passport source. Without them an empty in-memory store is used (everything is `unregistered`). |
| `NOTION_PROP_*` | Override provisional Notion property names (`AGENT_ID`, `NAME`, `SCOPES`, `HOSTS`, `STATUS`). |

## Deploy (not yet done)
Cloud Run with `--no-allow-unauthenticated`, a dedicated service account holding only `roles/secretmanager.secretAccessor` on the signing secret, and `NOTION_TOKEN` as a secret reference. Callers need `roles/run.invoker`.

## Test
`python3 -m unittest discover -s tests -t .` (no third-party test dependencies).

## Open items
- Notion Agent Passport schema is provisional (`app/passports.py`).
- Endpoint contract is a first proposal; confirm with the ticket.
- Not run under uvicorn or in Docker in the build sandbox (PyPI is blocked there).
