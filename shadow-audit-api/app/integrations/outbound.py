"""Notion + Slack clients over an injectable HTTP transport (stdlib urllib by default)."""
import json
import urllib.request
from typing import Any, Callable, Dict

Transport = Callable[[str, str, Dict[str, str], Any], Dict]


def urllib_transport(method: str, url: str, headers: Dict[str, str], body: Any) -> Dict:
    req = urllib.request.Request(url, method=method, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=15) as r:  # noqa: S310 - fixed https endpoints
        raw = r.read()
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except ValueError:
        return {"raw": raw.decode("utf-8", "replace")}  # Slack webhooks answer plain "ok"


class NotionClient:
    def __init__(self, token: str, db_id: str, transport: Transport = urllib_transport):
        self.db_id, self.t = db_id, transport
        self.h = {"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28",
                  "Content-Type": "application/json"}

    def write_passport(self, rec: Dict) -> str:
        p = lambda t: {"rich_text": [{"text": {"content": str(t)[:1900]}}]}  # noqa: E731
        props = {
            "Passport": {"title": [{"text": {"content": f"{rec['agent_id']} {rec['audit_id']}"}}]},
            "Agent ID": p(rec["agent_id"]), "Audit ID": p(rec["audit_id"]),
            "Environment": {"select": {"name": rec["environment"]}},
            "Status": {"select": {"name": rec["status"]}},
            "Overall Score": {"number": rec["overall_score"]},
            "Audit Complete": {"checkbox": rec["complete"]},
            "Issued": {"date": {"start": rec["issued"]}}, "Expires": {"date": {"start": rec["expires"]}},
            "Detected Risks": p(rec["risk_summary"]),
            "Signed Passport JSON": p(json.dumps(rec["passport"], separators=(",", ":"))),
            "Verification Method": p(rec["passport"]["proof"]["verificationMethod"]),
        }
        out = self.t("POST", "https://api.notion.com/v1/pages", self.h,
                     {"parent": {"database_id": self.db_id}, "properties": props})
        return out.get("url", "")


class SlackNotifier:
    def __init__(self, webhook: str, transport: Transport = urllib_transport):
        self.webhook, self.t = webhook, transport

    def notify(self, text: str) -> None:
        self.t("POST", self.webhook, {"Content-Type": "application/json"}, {"text": text})
