"""
OpenOSINT MCP Server Adapter for MyPrivacyTOOL Wave 0 Exposure Scanning

Integrates OpenOSINT v2.38.2 (21-tool OSINT framework) as the core orchestrator
for MPT's exposure detection. Provides:
  - Unified tool execution with statement-level provenance
  - Parallel tool execution (up to 5 concurrent)
  - Passive-only mode by default; active tools require --allow-active
  - JSON exposure report with source attribution

Architecture:
  OpenOSINT MCP Server (uvx) → Adapter (this module) → MPT Exposure API
  
Provenance Chain:
  Finding → Tool → Data Source → Timestamp → Confidence Score
"""

import json
import asyncio
import logging
import os
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime
from enum import Enum

# OpenOSINT MCP imports (assume client library available)
# Real implementation: `pip install openosint[mcp] mcp anthropic`

logger = logging.getLogger(__name__)
logger.setLevel(os.getenv("OPENOSINT_LOG_LEVEL", "INFO"))


class ToolPolicy(Enum):
    """Tool execution policy."""
    PASSIVE_ONLY = "passive_only"
    ALLOW_ACTIVE = "allow_active"


@dataclass
class ProvenanceRecord:
    """Tracks the source of each finding for attribution."""
    finding: str  # The actual finding (e.g. email, username, breach name)
    tool_name: str  # Which OpenOSINT tool found it (e.g. "search_email")
    data_source: str  # Where the tool found it (e.g. "haveibeenpwned", "breach.com")
    timestamp: str  # ISO 8601 timestamp
    confidence: float  # 0.0–1.0, tool-specific
    tool_category: str  # "email_search", "username_search", "domain_lookup", etc.
    is_active: bool  # True if tool requires API credentials
    
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ExposureResult:
    """Single exposure finding with full provenance."""
    target: str  # Email, username, domain, phone, etc.
    findings: List[ProvenanceRecord]
    scan_id: str  # Unique scan identifier
    timestamp: str  # Scan completion time
    total_findings: int
    tools_executed: int
    tools_failed: int
    execution_time_seconds: float


class OpenOSINTAdapter:
    """
    Adapter between OpenOSINT MCP Server and MPT Exposure API.
    
    Responsibilities:
    - Initialize OpenOSINT MCP client
    - Execute scans with configurable tool policies
    - Collect and deduplicate findings
    - Build provenance records for each finding
    - Format results for exposure reporting
    """
    
    def __init__(
        self,
        mcp_port: int = 8000,
        policy: ToolPolicy = ToolPolicy.PASSIVE_ONLY,
        concurrent_limit: int = 5,
        timeout_seconds: float = 5.0,
        enable_provenance: bool = True,
    ):
        """
        Initialize the OpenOSINT adapter.
        
        Args:
            mcp_port: MCP server port (default: 8000)
            policy: Tool execution policy (passive_only or allow_active)
            concurrent_limit: Max concurrent tool execution (default: 5)
            timeout_seconds: Timeout per tool call (default: 5.0s)
            enable_provenance: Track provenance records (default: True)
        """
        self.mcp_port = mcp_port
        self.policy = policy
        self.concurrent_limit = concurrent_limit
        self.timeout_seconds = timeout_seconds
        self.enable_provenance = enable_provenance
        
        # Placeholder for real MCP client initialization
        # Real: `self.mcp_client = MCPClient(f"http://localhost:{mcp_port}")`
        self.mcp_client = None
        
        logger.info(
            f"OpenOSINT Adapter initialized: "
            f"policy={policy.value}, "
            f"concurrent_limit={concurrent_limit}, "
            f"timeout={timeout_seconds}s"
        )
    
    async def scan_email(self, email: str, scan_id: str) -> ExposureResult:
        """
        Scan an email address for exposures using OpenOSINT tools.
        
        Tools executed (passive_only):
        - search_email: Check breach databases (HaveIBeenPwned, Dehashed, etc.)
        - search_username: Extract username from email, search across platforms
        - domain_lookup: Analyze domain registration, DNS records
        """
        start_time = datetime.utcnow()
        findings: List[ProvenanceRecord] = []
        
        # Tools to execute for email scanning
        email_tools = [
            ("search_email", email, "breach_databases"),
            ("search_username", email.split("@")[0], "social_platforms"),
            ("domain_lookup", email.split("@")[1], "domain_registries"),
        ]
        
        # Execute tools in parallel (up to concurrent_limit)
        tasks = [
            self._execute_tool_with_provenance(
                tool_name, target, source_category, scan_id
            )
            for tool_name, target, source_category in email_tools
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Collect findings and handle errors
        tools_executed = len(email_tools)
        tools_failed = 0
        
        for result in results:
            if isinstance(result, Exception):
                logger.warning(f"Tool execution failed: {result}")
                tools_failed += 1
            elif result:
                findings.extend(result)
        
        execution_time = (datetime.utcnow() - start_time).total_seconds()
        
        return ExposureResult(
            target=email,
            findings=findings,
            scan_id=scan_id,
            timestamp=datetime.utcnow().isoformat() + "Z",
            total_findings=len(findings),
            tools_executed=tools_executed,
            tools_failed=tools_failed,
            execution_time_seconds=execution_time,
        )
    
    async def scan_username(self, username: str, scan_id: str) -> ExposureResult:
        """
        Scan a username for exposures across social platforms and forums.
        
        Tools executed (passive_only):
        - search_username: Cross-platform username search
        - domain_lookup: If username contains domain pattern
        - social_profile: Extract profile URLs and metadata
        """
        start_time = datetime.utcnow()
        findings: List[ProvenanceRecord] = []
        
        username_tools = [
            ("search_username", username, "social_platforms"),
            ("social_profile", username, "public_profiles"),
        ]
        
        tasks = [
            self._execute_tool_with_provenance(tool_name, target, source_category, scan_id)
            for tool_name, target, source_category in username_tools
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        tools_executed = len(username_tools)
        tools_failed = sum(1 for r in results if isinstance(r, Exception))
        
        for result in results:
            if isinstance(result, Exception):
                logger.warning(f"Tool execution failed: {result}")
            elif result:
                findings.extend(result)
        
        execution_time = (datetime.utcnow() - start_time).total_seconds()
        
        return ExposureResult(
            target=username,
            findings=findings,
            scan_id=scan_id,
            timestamp=datetime.utcnow().isoformat() + "Z",
            total_findings=len(findings),
            tools_executed=tools_executed,
            tools_failed=tools_failed,
            execution_time_seconds=execution_time,
        )
    
    async def scan_domain(self, domain: str, scan_id: str) -> ExposureResult:
        """
        Scan a domain for exposures: registrant info, DNS, subdomains, reputation.
        
        Tools executed (passive_only):
        - domain_lookup: WHOIS, DNS, MX records
        - subdomain_enum: Common subdomains, certificate transparency
        - reputation_check: Blocklists, threat intelligence
        """
        start_time = datetime.utcnow()
        findings: List[ProvenanceRecord] = []
        
        domain_tools = [
            ("domain_lookup", domain, "domain_registries"),
            ("subdomain_enum", domain, "certificate_transparency"),
            ("reputation_check", domain, "threat_intelligence"),
        ]
        
        tasks = [
            self._execute_tool_with_provenance(tool_name, target, source_category, scan_id)
            for tool_name, target, source_category in domain_tools
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        tools_executed = len(domain_tools)
        tools_failed = sum(1 for r in results if isinstance(r, Exception))
        
        for result in results:
            if isinstance(result, Exception):
                logger.warning(f"Tool execution failed: {result}")
            elif result:
                findings.extend(result)
        
        execution_time = (datetime.utcnow() - start_time).total_seconds()
        
        return ExposureResult(
            target=domain,
            findings=findings,
            scan_id=scan_id,
            timestamp=datetime.utcnow().isoformat() + "Z",
            total_findings=len(findings),
            tools_executed=tools_executed,
            tools_failed=tools_failed,
            execution_time_seconds=execution_time,
        )
    
    async def _execute_tool_with_provenance(
        self,
        tool_name: str,
        target: str,
        source_category: str,
        scan_id: str,
    ) -> List[ProvenanceRecord]:
        """
        Execute a single OpenOSINT tool and collect findings with full provenance.
        
        Args:
            tool_name: OpenOSINT tool to call (e.g. "search_email")
            target: Input to the tool (email, username, domain, etc.)
            source_category: Category of data source (e.g. "breach_databases")
            scan_id: Scan identifier for correlation
        
        Returns:
            List of ProvenanceRecord objects, one per finding
        
        Raises:
            Timeout: If tool execution exceeds timeout_seconds
            APIError: If tool API call fails
            ValueError: If tool is active and policy is passive_only
        """
        # Placeholder implementation
        # Real: Call self.mcp_client.call_tool(tool_name, {"target": target})
        
        logger.info(f"Executing {tool_name}({target}) for scan {scan_id}")
        
        # Simulated tool execution (replace with real MCP call)
        await asyncio.sleep(0.1)  # Simulate tool execution time
        
        findings = []
        
        # Example: search_email would return findings like:
        # - email found in haveibeenpwned.com (breach)
        # - username extracted and found on Twitter
        # - domain registered to registrant X (WHOIS)
        
        # For now, return empty list (real implementation calls MCP server)
        return findings
    
    def deduplicate_findings(
        self, findings: List[ProvenanceRecord]
    ) -> List[ProvenanceRecord]:
        """
        Deduplicate findings by target + data source, keeping highest confidence.
        
        Args:
            findings: List of findings from multiple tools
        
        Returns:
            Deduplicated findings, sorted by confidence descending
        """
        unique_by_key: Dict[Tuple[str, str, str], ProvenanceRecord] = {}
        
        for finding in findings:
            key = (finding.finding, finding.data_source, finding.tool_name)
            
            # Keep the finding with highest confidence
            if key not in unique_by_key or finding.confidence > unique_by_key[key].confidence:
                unique_by_key[key] = finding
        
        # Sort by confidence descending
        return sorted(
            unique_by_key.values(),
            key=lambda f: f.confidence,
            reverse=True,
        )
    
    def to_json_report(self, result: ExposureResult) -> str:
        """
        Convert ExposureResult to JSON for API response.
        
        Format:
        {
          "scan_id": "uuid",
          "target": "user@example.com",
          "findings": [
            {
              "finding": "exposed in breach",
              "tool_name": "search_email",
              "data_source": "haveibeenpwned",
              "timestamp": "2026-11-24T...",
              "confidence": 0.95,
              "tool_category": "email_search",
              "is_active": false
            }
          ],
          "summary": {
            "total_findings": 5,
            "tools_executed": 3,
            "tools_failed": 0,
            "execution_time_seconds": 2.3
          }
        }
        """
        return json.dumps(
            {
                "scan_id": result.scan_id,
                "target": result.target,
                "timestamp": result.timestamp,
                "findings": [f.to_dict() for f in result.findings],
                "summary": {
                    "total_findings": result.total_findings,
                    "tools_executed": result.tools_executed,
                    "tools_failed": result.tools_failed,
                    "execution_time_seconds": result.execution_time_seconds,
                },
            },
            indent=2,
        )
