#!/bin/bash
# API Testing Script

set -e

# Default to production
DOMAIN="${1:-https://uplc.wtf}"

echo "🧪 Testing UPLC API Endpoints on: $DOMAIN"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Test 1: Main site
echo "1. Testing main site..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$DOMAIN")
if [ "$STATUS" = "200" ]; then
    echo -e "${GREEN}✓${NC} Main site: HTTP $STATUS"
else
    echo -e "${RED}✗${NC} Main site: HTTP $STATUS"
fi

# Test 2: Koios proxy
echo ""
echo "2. Testing /api/koios..."
RESPONSE=$(curl -s -X POST "$DOMAIN/api/koios" \
    -H "Content-Type: application/json" \
    -d '{"_script_hashes":["e1317b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309"]}')

if echo "$RESPONSE" | grep -q "script_hash"; then
    echo -e "${GREEN}✓${NC} Koios proxy working"
    echo "  Response preview: $(echo $RESPONSE | jq -r '.[0].script_hash' 2>/dev/null || echo 'OK')"
else
    echo -e "${RED}✗${NC} Koios proxy failed"
    echo "  Response: $RESPONSE"
fi

# Test 3: Enhancement API
echo ""
echo "3. Testing /api/enhance..."
echo -e "${YELLOW}ℹ${NC} This will call Claude API (uses credits)"
read -p "Continue? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    RESPONSE=$(curl -s -X POST "$DOMAIN/api/enhance" \
        -H "Content-Type: application/json" \
        -d '{
            "scriptHash": "test_script",
            "aikenCode": "validator test { spend(d, r, ref, tx) { True } }",
            "purpose": "spend",
            "builtins": {"equalsInteger": 5, "addInteger": 3},
            "enhance": ["naming"]
        }')

    if echo "$RESPONSE" | grep -q "naming"; then
        echo -e "${GREEN}✓${NC} Enhancement API working"
        echo "  Response preview: $(echo $RESPONSE | jq '.naming' 2>/dev/null || echo 'OK')"

        # Check if cached
        if echo "$RESPONSE" | grep -q '"cached":true'; then
            echo -e "${GREEN}✓${NC} Cache working (response was cached)"
        fi
    elif echo "$RESPONSE" | grep -q "error"; then
        echo -e "${RED}✗${NC} Enhancement API error"
        echo "  Error: $(echo $RESPONSE | jq -r '.error' 2>/dev/null)"
    else
        echo -e "${YELLOW}⚠${NC} Enhancement API response unexpected"
        echo "  Response: $RESPONSE"
    fi
else
    echo "Skipped enhancement API test"
fi

# Test 4: Test cached request
echo ""
echo "4. Testing cache (second request)..."
RESPONSE2=$(curl -s -X POST "$DOMAIN/api/enhance" \
    -H "Content-Type: application/json" \
    -d '{
        "scriptHash": "test_script",
        "aikenCode": "validator test { spend(d, r, ref, tx) { True } }",
        "purpose": "spend",
        "builtins": {"equalsInteger": 5},
        "enhance": ["naming"]
    }')

if echo "$RESPONSE2" | grep -q '"cached":true'; then
    echo -e "${GREEN}✓${NC} Cache is working (request served from KV)"
else
    echo -e "${YELLOW}⚠${NC} Cache might not be working or TTL expired"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✨ Testing complete!"
echo ""
echo "To test locally:"
echo "  ./scripts/test-api.sh http://localhost:4321"
echo ""
