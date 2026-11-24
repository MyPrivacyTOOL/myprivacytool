"""FastAPI app for the OpenOSINT exposure routes (docker-compose service `shadow-audit-api`, MPC-11203).

Separate from main.py (the stdlib audit WSGI app) on purpose: these routes are a Wave 0 POC and
have no auth, so they must not be mounted on the audited, token-protected service.
Run: uvicorn app.exposure_app:app --host 0.0.0.0 --port 8001
"""
from fastapi import FastAPI

from app.routes.exposure import router

app = FastAPI(title="MPT exposure scan (OpenOSINT POC)")
app.include_router(router)
