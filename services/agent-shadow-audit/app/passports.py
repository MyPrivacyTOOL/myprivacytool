"""Agent Passport lookup. The Notion schema is not final, so the service depends
only on the small Passport shape below; field mapping lives in NotionPassportStore."""
import json
import os
import urllib.request
from dataclasses import dataclass, field
from typing import Optional, Protocol


@dataclass
class Passport:
    agent_id: str
    name: str = ""
    declared_scopes: list = field(default_factory=list)
    declared_hosts: list = field(default_factory=list)
    status: str = "active"  # active | revoked


class PassportStore(Protocol):
    def get(self, agent_id: str) -> Optional[Passport]: ...


class InMemoryPassportStore:
    def __init__(self, passports=()):
        self._p = {p.agent_id: p for p in passports}

    def get(self, agent_id):
        return self._p.get(agent_id)


class NotionPassportStore:
    """Queries a Notion database. Property names are PROVISIONAL until the
    Agent Passport schema is defined; override with the NOTION_PROP_* env vars."""

    def __init__(self, token: str, database_id: str):
        self._token, self._db = token, database_id
        self._prop = {k: os.environ.get(f"NOTION_PROP_{k.upper()}", d) for k, d in
                      {"agent_id": "Agent ID", "name": "Name", "scopes": "Declared Scopes",
                       "hosts": "Declared Hosts", "status": "Status"}.items()}

    def get(self, agent_id):
        body = {"filter": {"property": self._prop["agent_id"], "rich_text": {"equals": agent_id}}, "page_size": 1}
        req = urllib.request.Request(
            f"https://api.notion.com/v1/databases/{self._db}/query", data=json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {self._token}", "Notion-Version": "2022-06-28",
                     "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            results = json.load(r)["results"]
        if not results:
            return None
        props = results[0]["properties"]

        def text(key):
            items = props.get(self._prop[key], {}).get("rich_text") or props.get(self._prop[key], {}).get("title") or []
            return "".join(i.get("plain_text", "") for i in items)

        def multi(key):
            return [o["name"] for o in props.get(self._prop[key], {}).get("multi_select", [])]

        status = (props.get(self._prop["status"], {}).get("select") or {}).get("name", "active").lower()
        return Passport(agent_id, text("name"), multi("scopes"), multi("hosts"), status)
