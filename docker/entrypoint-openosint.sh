#!/bin/bash
# OpenOSINT MCP Server Entrypoint
#
# Initializes OpenOSINT environment, validates configuration, and starts MCP server.
#
# Environment variables (with defaults):
#   OPENOSINT_MODE=mcp              MCP server mode
#   OPENOSINT_LOG_LEVEL=INFO        Logging level
#   OPENOSINT_TOOL_POLICY=passive_only  Policy: passive_only or allow_active
#   OPENOSINT_ALLOW_ACTIVE=false    Allow active tools (requires explicit override)
#   MCP_PORT=8000                   MCP server port
#   ANTHROPIC_API_KEY               Anthropic API key (optional, for Claude integration)

set -e

# Defaults
OPENOSINT_MODE="${OPENOSINT_MODE:-mcp}"
OPENOSINT_LOG_LEVEL="${OPENOSINT_LOG_LEVEL:-INFO}"
OPENOSINT_TOOL_POLICY="${OPENOSINT_TOOL_POLICY:-passive_only}"
OPENOSINT_ALLOW_ACTIVE="${OPENOSINT_ALLOW_ACTIVE:-false}"
MCP_PORT="${MCP_PORT:-8000}"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}MyPrivacyTOOL — OpenOSINT MCP Server Initialization${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 1: Validate configuration
echo -e "${YELLOW}[1/5] Validating configuration...${NC}"

if [[ "$OPENOSINT_TOOL_POLICY" != "passive_only" && "$OPENOSINT_TOOL_POLICY" != "allow_active" ]]; then
    echo -e "${RED}✗ Invalid OPENOSINT_TOOL_POLICY: $OPENOSINT_TOOL_POLICY (must be 'passive_only' or 'allow_active')${NC}"
    exit 1
fi

if [[ "$OPENOSINT_ALLOW_ACTIVE" != "true" && "$OPENOSINT_ALLOW_ACTIVE" != "false" ]]; then
    echo -e "${RED}✗ Invalid OPENOSINT_ALLOW_ACTIVE: $OPENOSINT_ALLOW_ACTIVE (must be 'true' or 'false')${NC}"
    exit 1
fi

if [[ "$OPENOSINT_TOOL_POLICY" == "allow_active" && "$OPENOSINT_ALLOW_ACTIVE" == "false" ]]; then
    echo -e "${YELLOW}! Warning: Tool policy is 'allow_active' but OPENOSINT_ALLOW_ACTIVE is false${NC}"
    echo -e "${YELLOW}  Active tools will NOT execute unless explicitly enabled${NC}"
fi

echo -e "${GREEN}✓ Configuration valid${NC}"
echo "  Mode: $OPENOSINT_MODE"
echo "  Tool Policy: $OPENOSINT_TOOL_POLICY"
echo "  Allow Active: $OPENOSINT_ALLOW_ACTIVE"
echo "  Log Level: $OPENOSINT_LOG_LEVEL"
echo "  MCP Port: $MCP_PORT"
echo ""

# Step 2: Check Python dependencies
echo -e "${YELLOW}[2/5] Checking Python dependencies...${NC}"

python3 -c "import openosint; print(f'  OpenOSINT version: {openosint.__version__}')" 2>/dev/null || {
    echo -e "${RED}✗ OpenOSINT not installed${NC}"
    exit 1
}

python3 -c "import mcp; print('  MCP protocol: installed')" 2>/dev/null || {
    echo -e "${RED}✗ MCP not installed${NC}"
    exit 1
}

python3 -c "import fastapi; print('  FastAPI: installed')" 2>/dev/null || {
    echo -e "${RED}✗ FastAPI not installed${NC}"
    exit 1
}

python3 -c "import uvicorn; print('  Uvicorn: installed')" 2>/dev/null || {
    echo -e "${RED}✗ Uvicorn not installed${NC}"
    exit 1
}

echo -e "${GREEN}✓ All dependencies present${NC}"
echo ""

# Step 3: Validate MCP configuration file
echo -e "${YELLOW}[3/5] Validating MCP configuration...${NC}"

if [[ ! -f "/app/.mcp.json" ]]; then
    echo -e "${RED}✗ .mcp.json not found at /app/.mcp.json${NC}"
    exit 1
fi

python3 -c "import json; json.load(open('/app/.mcp.json'))" 2>/dev/null || {
    echo -e "${RED}✗ .mcp.json is not valid JSON${NC}"
    exit 1
}

MCP_TOOLS=$(python3 -c "import json; config = json.load(open('/app/.mcp.json')); print(len(config.get('tools', [])))")
echo -e "${GREEN}✓ MCP configuration valid${NC}"
echo "  Tools configured: $MCP_TOOLS"
echo ""

# Step 4: Check port availability
echo -e "${YELLOW}[4/5] Checking port availability...${NC}"

if netstat -tuln 2>/dev/null | grep -q ":$MCP_PORT "; then
    echo -e "${RED}✗ Port $MCP_PORT already in use${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Port $MCP_PORT available${NC}"
echo ""

# Step 5: Ready to start
echo -e "${YELLOW}[5/5] Starting OpenOSINT MCP server...${NC}"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${GREEN}✓ All checks passed. Starting server...${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Export environment for FastAPI
export OPENOSINT_MODE
export OPENOSINT_LOG_LEVEL
export OPENOSINT_TOOL_POLICY
export OPENOSINT_ALLOW_ACTIVE
export MCP_PORT

# Start server (command passed as args to this script)
exec "$@"
