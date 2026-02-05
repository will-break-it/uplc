# UPLC Analyzer

**Live at:** https://uplc.pages.dev

Analyze Cardano Plutus smart contracts by decoding their UPLC bytecode.

## Features

- 🔍 **Script Lookup** — Paste any script hash, fetch from Koios API
- 📊 **Builtin Analysis** — Extract and categorize Plutus builtins
- ⚠️ **Error Messages** — Decode human-readable error strings from bytecode
- 🏷️ **Contract Classification** — Auto-detect NFT marketplace, DEX, lending, etc.
- 🔀 **Architecture Diagrams** — Mermaid flowcharts of contract logic
- 🦊 **Pseudo-Aiken** — Reconstructed source code approximation
- ⚡ **MEV Risk Rating** — HIGH/MEDIUM/LOW based on contract type

## How It Works

1. Fetches script CBOR from [Koios API](https://api.koios.rest)
2. Extracts readable strings (error messages) from bytecode
3. Analyzes builtin function usage patterns
4. Classifies contract type based on patterns
5. Generates Mermaid diagrams and pseudo-Aiken reconstruction

## Tech Stack

- **Framework:** [Astro](https://astro.build) + React
- **Hosting:** [Cloudflare Pages](https://pages.cloudflare.com)
- **API Proxy:** Cloudflare Functions (CORS workaround)
- **Diagrams:** [Mermaid](https://mermaid.js.org)
- **Data:** [Koios API](https://api.koios.rest)

## Development

```bash
npm install
npm run dev     # http://localhost:4321
npm run build   # Build to dist/
```

## Deploy

Automatic deployment via Cloudflare Pages on push to `main`.

Manual deploy:
```bash
npm run build
wrangler pages deploy dist --project-name uplc
```

## Example Scripts

| Hash | Protocol | Type |
|------|----------|------|
| `4a59ebd93ea53d1bbf7f82232c7b012700a0cf4bb78d879dabb1a20a` | NFT Marketplace | MEDIUM risk |
| `a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b` | Minswap V1 Order | HIGH risk |
| `e1317b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309` | Minswap V1 Pool | HIGH risk |

## License

MIT
