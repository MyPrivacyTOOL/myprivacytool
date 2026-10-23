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

    @property
    def slack_enabled(self) -> bool:
        """True only for a real Slack incoming-webhook URL. A placeholder secret (e.g. before the owner
        creates the webhook) must not cause a failing call and an error line on every audit."""
        return self.slack_webhook_url.startswith("https://hooks.slack.com/")

    @classmethod
    def from_env(cls) -> "Settings":
        g = os.environ.get
        env = g("SHADOW_AUDIT_ENV", "staging")
        if env not in ("staging", "production"):
            raise ValueError("SHADOW_AUDIT_ENV must be staging or production")
        return cls(env, g("API_TOKEN", ""), g("NOTION_TOKEN", ""), g("NOTION_DB_ID", ""),
                   g("SLACK_WEBHOOK_URL", ""), g("SIGNING_KEY_HEX", ""),
                   g("VERIFICATION_METHOD", f"urn:shadow-audit:key:{env}#1"),
                   int(g("LOOKBACK_DAYS", "7")),
                   tuple(r.strip().lower() for r in g("ALLOWED_REGIONS", "eu").split(",") if r.strip()),
                   int(g("MIN_COVERAGE", "5")))
