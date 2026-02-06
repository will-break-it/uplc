#!/bin/bash
# Deployment Verification Script

set -e

echo "🔍 Verifying UPLC Deployment Configuration..."
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Check if wrangler is installed
echo "1. Checking Wrangler CLI..."
if command -v wrangler &> /dev/null; then
    echo -e "${GREEN}✓${NC} Wrangler CLI installed"
else
    echo -e "${RED}✗${NC} Wrangler CLI not found. Install with: npm install -g wrangler"
    exit 1
fi

# 2. Check project configuration
echo ""
echo "2. Checking project configuration..."
if [ -f "wrangler.toml" ]; then
    echo -e "${GREEN}✓${NC} wrangler.toml found"

    # Check KV namespace
    if grep -q "UPLC_CACHE" wrangler.toml; then
        echo -e "${GREEN}✓${NC} KV namespace configured"
    else
        echo -e "${RED}✗${NC} KV namespace not configured"
    fi
else
    echo -e "${RED}✗${NC} wrangler.toml not found"
    exit 1
fi

# 3. Check secrets (requires authentication)
echo ""
echo "3. Checking secrets..."
echo -e "${YELLOW}ℹ${NC} Attempting to list secrets (requires Cloudflare auth)..."

if wrangler pages secret list --project-name=uplc 2>/dev/null | grep -q "ANTHROPIC_API_KEY"; then
    echo -e "${GREEN}✓${NC} ANTHROPIC_API_KEY is set"
else
    echo -e "${YELLOW}⚠${NC} ANTHROPIC_API_KEY might not be set or you need to authenticate"
    echo ""
    echo "To set the API key:"
    echo "  wrangler pages secret put ANTHROPIC_API_KEY --project-name=uplc"
    echo ""
fi

# 4. Check if packages are built
echo ""
echo "4. Checking package builds..."
PACKAGES=("parser" "patterns" "codegen" "ir" "cache")
for pkg in "${PACKAGES[@]}"; do
    if [ -d "packages/$pkg/dist" ]; then
        echo -e "${GREEN}✓${NC} @uplc/$pkg built"
    else
        echo -e "${RED}✗${NC} @uplc/$pkg not built (run: pnpm -r build)"
    fi
done

# 5. Check functions
echo ""
echo "5. Checking Cloudflare Functions..."
if [ -f "functions/api/koios.ts" ]; then
    echo -e "${GREEN}✓${NC} /api/koios endpoint exists"
else
    echo -e "${RED}✗${NC} /api/koios endpoint missing"
fi

if [ -f "functions/api/enhance.ts" ]; then
    echo -e "${GREEN}✓${NC} /api/enhance endpoint exists"
else
    echo -e "${RED}✗${NC} /api/enhance endpoint missing"
fi

# 6. Check main build
echo ""
echo "6. Checking main build..."
if [ -d "dist" ] && [ -f "dist/index.html" ]; then
    echo -e "${GREEN}✓${NC} Main site built (dist/ exists)"

    # Check size
    SIZE=$(du -sh dist | cut -f1)
    echo -e "  Build size: ${SIZE}"
else
    echo -e "${RED}✗${NC} Main site not built (run: pnpm build)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Next Steps:"
echo ""
echo "If ANTHROPIC_API_KEY is not set:"
echo "  wrangler pages secret put ANTHROPIC_API_KEY --project-name=uplc"
echo ""
echo "If packages are not built:"
echo "  pnpm -r build"
echo ""
echo "If main site is not built:"
echo "  pnpm build"
echo ""
echo "To deploy:"
echo "  pnpm deploy"
echo ""
echo "To test locally:"
echo "  pnpm dev"
echo ""
