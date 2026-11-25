"""
Exposure Scanning API Routes

Provides REST endpoints for initiating and retrieving exposure scans via OpenOSINT MCP.

Endpoints:
  POST   /api/v1/scans/email     - Scan email for exposures
  POST   /api/v1/scans/username  - Scan username for exposures
  POST   /api/v1/scans/domain    - Scan domain for exposures
  GET    /api/v1/scans/{scan_id} - Retrieve scan results
  GET    /api/v1/health          - Health check
"""

import uuid
import asyncio
import logging
from datetime import datetime
from typing import Optional, Dict, Any

from fastapi import APIRouter, HTTPException, Query, BackgroundTasks
from pydantic import BaseModel, EmailStr, Field

from app.openosint_mcp_adapter import OpenOSINTAdapter, ToolPolicy, ExposureResult

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["exposure"])

# Initialize adapter (would be dependency-injected in real app)
adapter = OpenOSINTAdapter(
    policy=ToolPolicy.PASSIVE_ONLY,
    concurrent_limit=5,
    enable_provenance=True,
)

# In-memory scan cache (replace with Redis/database in production)
_scan_cache: Dict[str, ExposureResult] = {}


# Request/Response Models
class EmailScanRequest(BaseModel):
    """Request to scan an email address."""
    email: EmailStr = Field(..., description="Email address to scan")
    priority: Optional[str] = Field(
        default="normal",
        description="Scan priority: normal, high, urgent",
        pattern="^(normal|high|urgent)$"
    )


class UsernameScanRequest(BaseModel):
    """Request to scan a username."""
    username: str = Field(
        ...,
        description="Username to scan",
        min_length=1,
        max_length=255,
    )
    priority: Optional[str] = Field(
        default="normal",
        description="Scan priority: normal, high, urgent",
        pattern="^(normal|high|urgent)$"
    )


class DomainScanRequest(BaseModel):
    """Request to scan a domain."""
    domain: str = Field(
        ...,
        description="Domain to scan (e.g. example.com)",
        min_length=1,
        max_length=255,
    )
    priority: Optional[str] = Field(
        default="normal",
        description="Scan priority: normal, high, urgent",
        pattern="^(normal|high|urgent)$"
    )


class ScanResponse(BaseModel):
    """Response after initiating a scan."""
    scan_id: str = Field(..., description="Unique scan identifier")
    target: str = Field(..., description="Email, username, or domain scanned")
    status: str = Field(default="queued", description="Scan status: queued, running, complete, failed")
    timestamp: str = Field(..., description="ISO 8601 scan initiation time")


class FindingRecord(BaseModel):
    """Single finding with provenance."""
    finding: str
    tool_name: str
    data_source: str
    timestamp: str
    confidence: float
    tool_category: str
    is_active: bool


class ScanResultResponse(BaseModel):
    """Complete scan results with findings."""
    scan_id: str
    target: str
    timestamp: str
    findings: list[FindingRecord]
    summary: Dict[str, Any]


# Endpoints
@router.post("/scans/email", response_model=ScanResponse)
async def scan_email(request: EmailScanRequest, background_tasks: BackgroundTasks) -> ScanResponse:
    """
    Initiate an exposure scan for an email address.
    
    OpenOSINT tools executed:
    - search_email: Check breach databases
    - search_breach: Breach exposure
    - search_username: Search the address's local part as a username
    
    Args:
        request: EmailScanRequest with email and optional priority
    
    Returns:
        ScanResponse with scan_id and status
    
    Status Flow:
    1. queued - Request received, added to queue
    2. running - Scan in progress
    3. complete - Scan finished, results available
    4. failed - Scan failed (timeout, API error, etc.)
    """
    scan_id = str(uuid.uuid4())
    
    logger.info(f"Email scan initiated: {scan_id}")
    
    # Create placeholder result (will be updated when scan completes)
    placeholder = ExposureResult(
        target=request.email,
        findings=[],
        scan_id=scan_id,
        timestamp=datetime.utcnow().isoformat() + "Z",
        total_findings=0,
        tools_executed=0,
        tools_failed=0,
        execution_time_seconds=0.0,
    )
    _scan_cache[scan_id] = placeholder
    
    # Queue scan to run in background
    background_tasks.add_task(_run_email_scan, scan_id, request.email)
    
    return ScanResponse(
        scan_id=scan_id,
        target=request.email,
        status="queued",
        timestamp=datetime.utcnow().isoformat() + "Z",
    )


@router.post("/scans/username", response_model=ScanResponse)
async def scan_username(request: UsernameScanRequest, background_tasks: BackgroundTasks) -> ScanResponse:
    """
    Initiate an exposure scan for a username.
    
    OpenOSINT tools executed:
    - search_username: Cross-platform username search
    - search_footprint: Public footprint
    
    Args:
        request: UsernameScanRequest with username and optional priority
    
    Returns:
        ScanResponse with scan_id and status
    """
    scan_id = str(uuid.uuid4())
    
    logger.info(f"Username scan initiated: {scan_id}")
    
    placeholder = ExposureResult(
        target=request.username,
        findings=[],
        scan_id=scan_id,
        timestamp=datetime.utcnow().isoformat() + "Z",
        total_findings=0,
        tools_executed=0,
        tools_failed=0,
        execution_time_seconds=0.0,
    )
    _scan_cache[scan_id] = placeholder
    
    background_tasks.add_task(_run_username_scan, scan_id, request.username)
    
    return ScanResponse(
        scan_id=scan_id,
        target=request.username,
        status="queued",
        timestamp=datetime.utcnow().isoformat() + "Z",
    )


@router.post("/scans/domain", response_model=ScanResponse)
async def scan_domain(request: DomainScanRequest, background_tasks: BackgroundTasks) -> ScanResponse:
    """
    Initiate an exposure scan for a domain.
    
    OpenOSINT tools executed:
    - search_domain, search_whois, search_dns, search_rdap, search_footprint
    
    Args:
        request: DomainScanRequest with domain and optional priority
    
    Returns:
        ScanResponse with scan_id and status
    """
    scan_id = str(uuid.uuid4())
    
    logger.info(f"Domain scan initiated: {scan_id}")
    
    placeholder = ExposureResult(
        target=request.domain,
        findings=[],
        scan_id=scan_id,
        timestamp=datetime.utcnow().isoformat() + "Z",
        total_findings=0,
        tools_executed=0,
        tools_failed=0,
        execution_time_seconds=0.0,
    )
    _scan_cache[scan_id] = placeholder
    
    background_tasks.add_task(_run_domain_scan, scan_id, request.domain)
    
    return ScanResponse(
        scan_id=scan_id,
        target=request.domain,
        status="queued",
        timestamp=datetime.utcnow().isoformat() + "Z",
    )


@router.get("/scans/{scan_id}", response_model=ScanResultResponse)
async def get_scan_result(scan_id: str) -> ScanResultResponse:
    """
    Retrieve scan results by scan_id.
    
    Args:
        scan_id: Unique scan identifier from POST /scans/*
    
    Returns:
        ScanResultResponse with findings and provenance
    
    Raises:
        HTTPException 404 if scan_id not found
        HTTPException 202 if scan still in progress
    """
    if scan_id not in _scan_cache:
        logger.warning(f"Scan not found: {scan_id}")
        raise HTTPException(status_code=404, detail=f"Scan {scan_id} not found")
    
    result = _scan_cache[scan_id]
    
    # Convert to response model
    findings = [
        FindingRecord(
            finding=f.finding,
            tool_name=f.tool_name,
            data_source=f.data_source,
            timestamp=f.timestamp,
            confidence=f.confidence,
            tool_category=f.tool_category,
            is_active=f.is_active,
        )
        for f in result.findings
    ]
    
    return ScanResultResponse(
        scan_id=result.scan_id,
        target=result.target,
        timestamp=result.timestamp,
        findings=findings,
        summary={
            "total_findings": result.total_findings,
            "tools_executed": result.tools_executed,
            "tools_failed": result.tools_failed,
            "execution_time_seconds": result.execution_time_seconds,
            "tool_errors": result.tool_errors,
        },
    )


@router.get("/health")
async def health_check() -> Dict[str, Any]:
    """
    Health check for OpenOSINT integration.
    
    Returns:
        Status of MCP server, adapter, and scans in cache
    """
    return {
        "status": "healthy",
        "component": "exposure-api",
        "mcp_server": "stdio (spawned per scan)",
        "scans_in_cache": len(_scan_cache),
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


# Background Tasks
async def _run_email_scan(scan_id: str, email: str) -> None:
    """Execute email scan in background."""
    try:
        logger.info(f"Running email scan: {scan_id}")
        result = await adapter.scan_email(email, scan_id)
        result.findings = adapter.deduplicate_findings(result.findings)
        _scan_cache[scan_id] = result
        logger.info(f"Email scan complete: {scan_id}, {len(result.findings)} findings")
    except Exception as e:
        logger.error(f"Email scan failed: {scan_id}: {e}")
        # Mark as failed in cache
        _scan_cache[scan_id].tools_failed += 1


async def _run_username_scan(scan_id: str, username: str) -> None:
    """Execute username scan in background."""
    try:
        logger.info(f"Running username scan: {scan_id}")
        result = await adapter.scan_username(username, scan_id)
        result.findings = adapter.deduplicate_findings(result.findings)
        _scan_cache[scan_id] = result
        logger.info(f"Username scan complete: {scan_id}, {len(result.findings)} findings")
    except Exception as e:
        logger.error(f"Username scan failed: {scan_id}: {e}")
        _scan_cache[scan_id].tools_failed += 1


async def _run_domain_scan(scan_id: str, domain: str) -> None:
    """Execute domain scan in background."""
    try:
        logger.info(f"Running domain scan: {scan_id}")
        result = await adapter.scan_domain(domain, scan_id)
        result.findings = adapter.deduplicate_findings(result.findings)
        _scan_cache[scan_id] = result
        logger.info(f"Domain scan complete: {scan_id}, {len(result.findings)} findings")
    except Exception as e:
        logger.error(f"Domain scan failed: {scan_id}: {e}")
        _scan_cache[scan_id].tools_failed += 1
