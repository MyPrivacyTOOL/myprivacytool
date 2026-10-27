import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    environment: str = "staging"          # production must be set explicitly
    api_token: str = ""                   # bearer token for all non-health routes
    notion_token: str = ""
    notion_db_id: str = ""
    slack_webhook_url: str = ""
    signing_key_hex: str = ""             # 32-byte seed, loaded from Secret Manager at runtime
    verification_method: str = "urn:shadow-audit:key:staging#1"
    lookback_days: int = 7
    allowed_regions: tuple = ("eu",)      # Risk #119: regions data may be sent to
    min_coverage: int = 5                 # detectors that must have had data before an audit can be APPROVED
    service_mode: str = "audit"           # "audit" (default) or "ingest": the ingest service only accepts log rows
    ingest_token: str = ""                # bearer token for POST /ingest/{agent}; separate from api_token
    ingest_agents: tuple = ()             # agent ids allowed to be ingested; empty means none
    queue_endpoint: str = ""              # MPC-8644: producer Worker URL that feeds mpt-shadow-audit-queue
    queue_secret: str = ""                # bearer secret for that endpoint (Secret Manager)

    @property
    def slack_enabled(self) -> bool:
        """True only for a real Slack incoming-webhook URL. A placeholder secret (e.g. before the owner
        creates the webhook) must not cause a failing call and an error line on every audit."""
        return self.slack_webhook_url.startswith("https://hooks.slack.com/")

    @property
    def queue_enabled(self) -> bool:
        return self.queue_endpoint.startswith("https://") and bool(self.queue_secret)

    @classmethod
    def from_env(cls) -> "Settings":
        g = os.environ.get
        env = g("SHADOW_AUDIT_ENV", "staging")
        if env not in ("staging", "production"):
            raise ValueError("SHADOW_AUDIT_ENV must be staging or production")
        mode = g("SERVICE_MODE", "audit")
        if mode not in ("audit", "ingest"):
            raise ValueError("SERVICE_MODE must be audit or ingest")
        return cls(environment=env, api_token=g("API_TOKEN", ""), notion_token=g("NOTION_TOKEN", ""),
                   notion_db_id=g("NOTION_DB_ID", ""), slack_webhook_url=g("SLACK_WEBHOOK_URL", ""),
                   signing_key_hex=g("SIGNING_KEY_HEX", ""),
                   verification_method=g("VERIFICATION_METHOD", f"urn:shadow-audit:key:{env}#1"),
                   lookback_days=int(g("LOOKBACK_DAYS", "7")),
                   allowed_regions=tuple(r.strip().lower() for r in g("ALLOWED_REGIONS", "eu").split(",") if r.strip()),
                   min_coverage=int(g("MIN_COVERAGE", "5")),
                   service_mode=mode, ingest_token=g("INGEST_TOKEN", ""),
                   ingest_agents=tuple(a.strip() for a in g("INGEST_AGENTS", "").split(",") if a.strip()),
                   queue_endpoint=g("QUEUE_ENDPOINT", ""), queue_secret=g("QUEUE_SECRET", ""))
