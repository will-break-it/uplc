# UPLC Analyzer

Decode Cardano Plutus smart contracts from their on-chain bytecode.

**Live:** https://uplc.pages.dev

## What it does

- Fetches script CBOR from Koios API
- Extracts human-readable error messages
- Analyzes builtin function usage patterns
- Classifies contract type (DEX, NFT, lending, etc.)
- Generates architecture diagrams (Mermaid)
- Reconstructs pseudo-Aiken source approximation

## Stack

Astro + React, hosted on Cloudflare Pages. Uses Cloudflare Functions as CORS proxy for Koios.

## Dev

```bash
npm install
npm run dev     # localhost:4321
npm run build
```

## Deploy

Auto-deploys on push to `main`, or manually:

```bash
wrangler pages deploy dist --project-name uplc
```
