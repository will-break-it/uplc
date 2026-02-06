<p align="center">
  <img src="public/banner.svg" alt="UPLC.WTF - Decode Cardano smart contracts" width="100%" />
</p>

<p align="center">
  <a href="https://uplc.wtf"><strong>uplc.wtf</strong></a> · Reverse-engineer Cardano Plutus smart contracts from on-chain bytecode
</p>

## How It Works

Cardano smart contracts are stored on-chain as nested binary encodings:

```
On-chain script bytes
    │
    ▼
┌─────────────────────────────────┐
│  CBOR wrapper (59XXXX header)   │  ← Binary serialization format
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Flat-encoded UPLC program      │  ← Compact bit-level encoding
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  UPLC AST                       │  ← Lambda calculus: Lambda, App,
│  (Untyped Plutus Core)          │    Force, Delay, Builtin, Const
└─────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────┐
│  Aiken-style pseudocode         │  ← AI-reconstructed high-level code
└─────────────────────────────────┘
```

**The three views in the tool:**
- **CBOR:** Raw hex bytes as stored on-chain
- **UPLC:** Decoded lambda calculus (parsed from flat encoding via [@harmoniclabs/uplc](https://github.com/harmoniclabs/uplc))
- **Aiken:** AI-decompiled pseudocode with inferred variable names and types

## Development

```bash
npm install
npm run dev     # localhost:4321
npm run build   # production build
```

### Environment Variables

For AI decompilation (Aiken tab) to work locally, create a `.dev.vars` file:

```
ANTHROPIC_API_KEY=sk-ant-...
```

The CBOR and UPLC views work without any API keys — only the AI features require configuration.

## License

MIT

---

<sub>Free to use. AI features cost money to run — [sponsors help keep it available](https://github.com/sponsors/will-break-it).</sub>
