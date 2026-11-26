"""FastAPI app for the OpenOSINT exposure routes (docker-compose service `shadow-audit-api`, MPC-11203).

Separate from main.py (the stdlib audit WSGI app) on purpose: these routes are a POC and are
not part of the audited service. They require `Authorization: Bearer <EXPOSURE_API_TOKEN>` on
every route except /api/v1/health, and refuse everything if that variable is unset.
Run: uvicorn app.exposure_app:app --host 0.0.0.0 --port 8001
"""
from fastapi import FastAPI

from app.routes.exposure import router

app = FastAPI(title="MPT exposure scan (OpenOSINT POC)")
app.include_router(router)
