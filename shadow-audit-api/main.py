"""Entry point: gunicorn main:app. Secrets come from env (injected from Secret Manager by Cloud Run).
SERVICE_MODE=audit (default) serves audits; SERVICE_MODE=ingest serves only POST /ingest/{agent}."""
import os

from app.config import Settings

s = Settings.from_env()

if s.service_mode == "ingest":
    from app.ingest import BigQuerySink, IngestService
    from app.ingest_api import make_ingest_app

    app = make_ingest_app(IngestService(BigQuerySink(os.environ.get("LOG_TABLE", "")), s.ingest_agents),
                          s.ingest_token, s.environment)
else:
    from app.api import make_app
    from app.crypto.signing import PassportSigner
    from app.integrations.outbound import NotionClient, QueuePublisher, SlackNotifier
    from app.integrations.sources import BigQuerySource
    from app.services.audit import AuditService

    signer = PassportSigner(bytes.fromhex(s.signing_key_hex), s.verification_method) if s.signing_key_hex else None
    svc = AuditService(s, BigQuerySource(os.environ.get("LOG_TABLE", "")), signer,
                       NotionClient(s.notion_token, s.notion_db_id) if s.notion_token else None,
                       SlackNotifier(s.slack_webhook_url) if s.slack_enabled else None,
                       QueuePublisher(s.queue_endpoint, s.queue_secret) if s.queue_enabled else None)
    app = make_app(svc, s.api_token)
