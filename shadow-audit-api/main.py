"""Entry point: gunicorn main:app. Secrets come from env (injected from Secret Manager by Cloud Run)."""
from app.api import make_app
from app.config import Settings
from app.crypto.signing import PassportSigner
from app.integrations.outbound import NotionClient, SlackNotifier
from app.integrations.sources import BigQuerySource
from app.services.audit import AuditService
import os

s = Settings.from_env()
signer = PassportSigner(bytes.fromhex(s.signing_key_hex), s.verification_method) if s.signing_key_hex else None
svc = AuditService(s, BigQuerySource(os.environ.get("LOG_TABLE", "")), signer,
                   NotionClient(s.notion_token, s.notion_db_id) if s.notion_token else None,
                   SlackNotifier(s.slack_webhook_url) if s.slack_enabled else None)
app = make_app(svc, s.api_token)
