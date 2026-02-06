# Deployment Guide - UPLC.WTF

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Build all packages
pnpm -r build

# 3. Build Astro site
pnpm build

# 4. Set API key (production)
wrangler pages secret put ANTHROPIC_API_KEY --project-name=uplc

# 5. Deploy
pnpm deploy
```

## Environment Setup

### Required Secrets

Set via Cloudflare Dashboard or Wrangler CLI:

```bash
# Set Claude API key
wrangler pages secret put ANTHROPIC_API_KEY
# Enter: sk-ant-api03-...

# Verify
wrangler pages secret list --project-name=uplc
```

### KV Namespace

Already configured in `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "UPLC_CACHE"
id = "7afe617d961440eab41446b192b03769"
```

To create a new KV namespace (if needed):

```bash
wrangler kv:namespace create "UPLC_CACHE"
# Update wrangler.toml with the returned ID
```

## Local Development

### 1. Start Dev Server

```bash
pnpm dev
```

Access at: http://localhost:4321

### 2. Test Functions Locally

```bash
wrangler pages dev dist --kv UPLC_CACHE
```

Access functions at:
- http://localhost:8788/api/koios
- http://localhost:8788/api/enhance

### 3. Local Environment Variables

Create `.dev.vars`:

```env
ANTHROPIC_API_KEY=sk-ant-...
```

**⚠️ NEVER commit `.dev.vars` to git!**

## Production Deployment

### Via GitHub Actions (Recommended)

Configured in `.github/workflows/deploy.yml`:

```yaml
- name: Deploy to Cloudflare Pages
  uses: cloudflare/pages-action@v1
  with:
    apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    projectName: uplc
    directory: dist
```

**Secrets to set in GitHub:**
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### Manual Deployment

```bash
# Build everything
pnpm install
pnpm -r build
pnpm build

# Deploy
npx wrangler pages deploy dist --project-name=uplc --commit-dirty=true
```

## Post-Deployment Verification

### 1. Test Main Site

```bash
curl https://uplc.wtf
# Should return HTML
```

### 2. Test Koios Proxy

```bash
curl -X POST https://uplc.wtf/api/koios \
  -H "Content-Type: application/json" \
  -d '{"_script_hashes":["e1317b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309"]}'
# Should return script info
```

### 3. Test Enhancement API

```bash
curl -X POST https://uplc.wtf/api/enhance \
  -H "Content-Type: application/json" \
  -d '{
    "scriptHash": "test",
    "aikenCode": "validator test { spend(d, r, ref, tx) { True } }",
    "purpose": "spend",
    "builtins": {},
    "enhance": ["diagram"]
  }'
# Should return Mermaid diagram
```

### 4. Check Caching

```bash
# First request (cold)
time curl -X POST https://uplc.wtf/api/enhance -d '...'
# ~5s (Claude API call)

# Second request (warm)
time curl -X POST https://uplc.wtf/api/enhance -d '...'
# ~50ms (KV cache hit, check for "cached": true)
```

## Monitoring

### Cloudflare Analytics

View at: https://dash.cloudflare.com/

Metrics to watch:
- **Requests/day:** Should be 1000-10000+
- **Cache hit ratio:** Target 60-70%
- **Function errors:** Should be <1%
- **P95 latency:** Should be <2s

### KV Usage

```bash
# Check KV storage
wrangler kv:key list --namespace-id=7afe617d961440eab41446b192b03769

# Check specific key
wrangler kv:key get "ast:e1317b..." --namespace-id=7afe617d961440eab41446b192b03769
```

### Logs

```bash
# Tail production logs
wrangler pages deployment tail

# Filter for errors
wrangler pages deployment tail --format=json | grep -i error
```

## Troubleshooting

### Issue: API key not working

**Check:**
```bash
wrangler pages secret list --project-name=uplc
```

**Fix:**
```bash
wrangler pages secret delete ANTHROPIC_API_KEY
wrangler pages secret put ANTHROPIC_API_KEY
```

### Issue: KV cache not working

**Check bindings:**
```toml
# wrangler.toml should have:
[[kv_namespaces]]
binding = "UPLC_CACHE"
id = "7afe617d961440eab41446b192b03769"
```

**Test directly:**
```bash
wrangler kv:key put "test" "value" --namespace-id=7afe617d961440eab41446b192b03769
wrangler kv:key get "test" --namespace-id=7afe617d961440eab41446b192b03769
```

### Issue: Build fails

**Clear cache and rebuild:**
```bash
rm -rf node_modules packages/*/node_modules packages/*/dist
pnpm install
pnpm -r build
pnpm build
```

### Issue: Functions not deploying

**Check function structure:**
```
functions/
  api/
    koios.ts       # ✓ Correct
    enhance.ts     # ✓ Correct
```

**Verify exports:**
```typescript
// Each function must export:
export const onRequest: PagesFunction<Env> = async (context) => {
  // ...
}
```

## Performance Optimization

### 1. Enable Caching Headers

Functions automatically set cache headers:

```typescript
'Cache-Control': 'public, max-age=3600'
```

### 2. Optimize Bundle Size

```bash
# Analyze bundle
npx astro build --analyze

# Tree-shake unused code
# Already done via ESM imports
```

### 3. Pre-warm Cache

```bash
# Script to pre-warm popular contracts
node scripts/warm-cache.js
```

### 4. Monitor API Usage

```bash
# Check Anthropic API usage
curl https://api.anthropic.com/v1/usage \
  -H "x-api-key: $ANTHROPIC_API_KEY"
```

## Rollback Procedure

### Quick Rollback

```bash
# List deployments
wrangler pages deployment list --project-name=uplc

# Promote previous deployment
wrangler pages deployment promote <deployment-id> --project-name=uplc
```

### GitHub Actions Rollback

1. Go to: https://github.com/will-break-it/uplc/actions
2. Find successful previous deployment
3. Click "Re-run all jobs"

## Cost Estimation

### Cloudflare Pages (Free Tier)

- **Requests:** 100,000/day (unlimited)
- **Bandwidth:** 100GB/month
- **Build minutes:** 500/month
- **KV reads:** 100,000/day
- **KV writes:** 1,000/day
- **KV storage:** 1GB

### Anthropic API

- **Claude 3.5 Sonnet:**
  - Input: $3 / million tokens
  - Output: $15 / million tokens

- **Estimated usage:**
  - 100 enhancements/day
  - ~1000 tokens input + 500 tokens output per request
  - **Cost:** ~$2-3/day = ~$60-90/month

**Total:** ~$60-90/month (mostly Anthropic API)

To reduce costs:
- Increase KV TTL (fewer API calls)
- Cache diagram generations longer
- Use Claude Haiku for simple tasks ($0.25/$1.25 per million tokens)

## Security Checklist

- [x] API key stored as secret (not in code)
- [x] CORS configured correctly
- [x] No sensitive data in logs
- [x] Rate limiting via Cloudflare (automatic)
- [x] Input validation in API endpoints
- [x] Error messages don't leak internals

## Backup & Disaster Recovery

### KV Backup

```bash
# Export all KV data
wrangler kv:key list --namespace-id=7afe617d961440eab41446b192b03769 --json > kv-backup.json

# Restore if needed
cat kv-backup.json | jq -r '.[] | .name' | while read key; do
  value=$(wrangler kv:key get "$key" --namespace-id=7afe617d961440eab41446b192b03769)
  wrangler kv:key put "$key" "$value" --namespace-id=NEW_NAMESPACE_ID
done
```

### Git Backup

All code is in Git - no additional backup needed.

## Support

- **Documentation:** `/IMPROVEMENTS.md`
- **Issues:** https://github.com/will-break-it/uplc/issues
- **Deployment help:** Create an issue with `deployment` label

---

**Last Updated:** 2026-02-06
