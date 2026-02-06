# UPLC.WTF

Reverse-engineer Cardano smart contracts from on-chain bytecode.

**Live:** https://uplc.wtf

## Features

- Decode UPLC bytecode from CBOR hex
- Extract error messages and trace strings
- Analyze builtin function usage patterns
- Classify contract type (DEX, NFT, lending, etc.)
- Generate architecture diagrams (Mermaid flowcharts)
- Reconstruct pseudo-Aiken source approximation via AI

## Stack

- **Frontend:** Astro + React + TypeScript
- **Hosting:** Cloudflare Pages
- **APIs:** Koios (script info), Anthropic Claude (decompilation)
- **UPLC Decoding:** @harmoniclabs/uplc (pure TypeScript, runs in browser)

## Development

```bash
npm install
npm run dev     # localhost:4321
npm run build   # production build
```

## Deployment

Deployed via Cloudflare Pages. Requires `ANTHROPIC_API_KEY` in Pages environment.

```bash
npm run build
npx wrangler pages deploy dist --project-name=uplc
```

## Security

This project uses API keys for AI decompilation. To prevent key abuse:

- **Branch protection:** Only `main` branch deploys to production
- **No direct pushes:** All changes require PR review
- **API keys:** Stored in Cloudflare Pages environment (not in repo)

## License

MIT
