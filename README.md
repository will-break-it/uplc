# UPLC.WTF

Reverse-engineer Cardano Plutus smart contracts from on-chain UPLC bytecode.

**Live:** [uplc.wtf](https://uplc.wtf)

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                          Browser                             │
├──────────────────────────────────────────────────────────────┤
│  Script Hash                                                 │
│      │                                                       │
│      ▼                                                       │
│  ┌────────┐    CBOR    ┌───────────────────┐                 │
│  │ Koios  │───────────▶│  @harmoniclabs/   │                 │
│  │  API   │            │      uplc         │                 │
│  └────────┘            │   (TypeScript)    │                 │
│                        └─────────┬─────────┘                 │
│                                  │                           │
│               ┌──────────────────┼──────────────────┐        │
│               ▼                  ▼                  ▼        │
│          Builtins          Trace Strings       UPLC AST      │
└──────────────────────────────────┬───────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────┐
│                     Cloudflare Worker                        │
├──────────────────────────────────────────────────────────────┤
│  ┌─────────────┐                                             │
│  │ Claude API  │──▶ Aiken pseudocode + Mermaid diagram       │
│  └─────────────┘                                             │
└──────────────────────────────────────────────────────────────┘
```

**Key:** UPLC decoding runs client-side. AI decompilation runs server-side (API key protected).

## Stack

- **Frontend:** Astro + React + TypeScript
- **Hosting:** Cloudflare Pages
- **UPLC Decoding:** [@harmoniclabs/uplc](https://github.com/harmoniclabs/uplc) (browser)
- **AI Decompilation:** Anthropic Claude (server)
- **Chain Data:** Koios API

## Development

```bash
npm install
npm run dev     # localhost:4321
npm run build   # production build
```

## License

MIT

---

<sub>Free to use. AI features cost money to run — [sponsors help keep it available](https://github.com/sponsors/will-break-it).</sub>
