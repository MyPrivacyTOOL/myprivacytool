import os

from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from .audit import run_audit
from .passports import InMemoryPassportStore, NotionPassportStore
from .signing import load_signer

MAX_ITEMS = 200


def _str_list(v, name):
    if not isinstance(v, list) or len(v) > MAX_ITEMS or not all(isinstance(i, str) and 0 < len(i) <= 256 for i in v):
        raise ValueError(f"{name} must be a list of up to {MAX_ITEMS} non-empty strings")
    return v


def create_app(signer=None, store=None) -> Starlette:
    signer = signer or load_signer()
    if store is None:
        token, db = os.environ.get("NOTION_TOKEN"), os.environ.get("NOTION_PASSPORT_DB")
        store = NotionPassportStore(token, db) if token and db else InMemoryPassportStore()

    async def health(request):
        return JSONResponse({"ok": True})

    async def keys(request):
        return JSONResponse(signer.jwks(), headers={"Cache-Control": "public, max-age=300"})

    async def audit(request):
        try:
            body = await request.json()
            if not isinstance(body, dict) or not isinstance(body.get("agent_id"), str) or not body["agent_id"]:
                raise ValueError("agent_id is required")
            scopes = _str_list(body.get("observed_scopes", []), "observed_scopes")
            hosts = _str_list(body.get("observed_hosts", []), "observed_hosts")
        except ValueError as e:  # includes JSON decode errors
            return JSONResponse({"error": str(e)}, status_code=400)
        try:
            passport = store.get(body["agent_id"])
        except Exception:
            return JSONResponse({"error": "passport lookup failed"}, status_code=502)
        result = run_audit(passport, scopes, hosts)
        result["agent_id"] = body["agent_id"]
        return JSONResponse(signer.sign(result))

    return Starlette(routes=[
        Route("/health", health),
        Route("/.well-known/agent-shadow-audit-keys.json", keys),
        Route("/v1/audit", audit, methods=["POST"]),
    ])


def app_factory():  # uvicorn --factory app.main:app_factory
    return create_app()
