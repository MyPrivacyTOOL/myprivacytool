"""WSGI app for the ingest-only service (SERVICE_MODE=ingest). It exposes /health and POST /ingest/{agent}
and nothing else. The service is reachable without a Google login (the droplet has none), so the ingest
token is the gate: it is checked BEFORE the body is read."""
import hmac
import json
import re
from typing import Callable

from app.ingest import IngestError, IngestService

MAX_BODY = 1_500_000
ROUTES = [
    ("GET", re.compile(r"^/health$"), "health"),
    ("POST", re.compile(r"^/ingest/([^/]+)$"), "ingest"),
]


def make_ingest_app(svc: IngestService, token: str, environment: str = "staging", max_body: int = MAX_BODY) -> Callable:
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
            if name == "health":
                return respond(start, "200 OK", {"status": "healthy", "mode": "ingest", "environment": environment})
            supplied = environ.get("HTTP_X_API_TOKEN") or environ.get("HTTP_AUTHORIZATION", "").removeprefix("Bearer ")
            if not token or not hmac.compare_digest(supplied, token):
                return respond(start, "401 Unauthorized", {"error": "unauthorized"})
            try:
                size = int(environ.get("CONTENT_LENGTH") or 0)
            except ValueError:
                return respond(start, "400 Bad Request", {"error": "invalid content length"})
            if size <= 0:
                return respond(start, "400 Bad Request", {"error": "empty body"})
            if size > max_body:
                return respond(start, "413 Payload Too Large", {"error": "body too large"})
            try:
                body = json.loads(environ["wsgi.input"].read(size))
            except (ValueError, KeyError):
                return respond(start, "400 Bad Request", {"error": "invalid json"})
            if not isinstance(body, dict):
                return respond(start, "400 Bad Request", {"error": "body must be an object with a rows list"})
            try:
                return respond(start, "200 OK", svc.ingest(mt.group(1), body.get("rows")))
            except IngestError as e:
                codes = {400: "400 Bad Request", 403: "403 Forbidden", 502: "502 Bad Gateway"}
                return respond(start, codes.get(e.status, "400 Bad Request"), {"error": e.message})
        return respond(start, "404 Not Found", {"error": "not found"})

    return app
