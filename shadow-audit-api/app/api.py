"""WSGI app (stdlib only). Bearer auth on everything except /health."""
import hmac
import json
import re
from typing import Callable

from app.services.audit import AuditService

ROUTES = [
    ("GET", re.compile(r"^/health$"), "health"),
    ("POST", re.compile(r"^/audit/([^/]+)$"), "trigger"),
    ("GET", re.compile(r"^/audit/([^/]+)$"), "get_audit"),
    ("GET", re.compile(r"^/agent/([^/]+)/audit-history$"), "history"),
    ("POST", re.compile(r"^/audit/([^/]+)/remediate$"), "remediate"),
]


def make_app(svc: AuditService, api_token: str) -> Callable:
    def respond(start, code: str, body) -> list:
        data = json.dumps(body).encode()
        start(code, [("Content-Type", "application/json"), ("Content-Length", str(len(data)))])
        return [data]

    def app(environ, start):
        method, path = environ["REQUEST_METHOD"], environ["PATH_INFO"]
        for m, rx, name in ROUTES:
            mt = rx.match(path)
            if m != method or not mt:
                continue
            if name != "health":
                supplied = environ.get("HTTP_AUTHORIZATION", "").removeprefix("Bearer ")
                if not api_token or not hmac.compare_digest(supplied, api_token):
                    return respond(start, "401 Unauthorized", {"error": "unauthorized"})
            try:
                size = int(environ.get("CONTENT_LENGTH") or 0)
                body = json.loads(environ["wsgi.input"].read(size) or b"{}") if size else {}
            except (ValueError, KeyError):
                return respond(start, "400 Bad Request", {"error": "invalid json"})
            if name == "health":
                return respond(start, "200 OK", {"status": "healthy", "environment": svc.s.environment})
            if name == "trigger":
                days = body.get("lookbackDays")
                if days is not None and not (isinstance(days, int) and 1 <= days <= 30):
                    return respond(start, "400 Bad Request", {"error": "lookbackDays must be 1-30"})
                return respond(start, "200 OK", svc.run(mt.group(1), days))
            if name == "get_audit":
                a = svc.audits.get(mt.group(1))
                return respond(start, "200 OK", a) if a else respond(start, "404 Not Found", {"error": "not found"})
            if name == "history":
                return respond(start, "200 OK", {"agent_id": mt.group(1), "audits": svc.history(mt.group(1))})
            ok = svc.remediate(mt.group(1), str(body.get("remediationId", "")), str(body.get("status", "")))
            return respond(start, "200 OK", {"status": "updated"}) if ok else \
                respond(start, "400 Bad Request", {"error": "unknown audit or invalid status"})
        return respond(start, "404 Not Found", {"error": "not found"})

    return app
