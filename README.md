<p align="center">
  <a href="https://uplc.wtf">
    <img src="public/banner.svg" alt="UPLC.WTF - Decode Cardano smart contracts" width="100%" />
  </a>
</p>

<p align="center">
  <a href="https://uplc.wtf"><strong>uplc.wtf</strong></a> · Reverse-engineer Cardano Plutus smart contracts from on-chain bytecode
</p>

## What It Does

Paste a Cardano script hash or CBOR hex → get readable Aiken code.

**Example output:**

```aiken
use aiken/list
use aiken/transaction.{OutputReference, Transaction}

type Datum {
  owner: ByteArray,
  deadline: Int,
}

type Action {
  Cancel
  Claim
}

validator decompiled_validator {
  spend(datum: Option<Datum>, redeemer: Action, own_ref: OutputReference, tx: Transaction) {
    expect Some(d) = datum

    when redeemer is {
      Cancel -> list.has(tx.extra_signatories, d.owner)
      Claim -> d.deadline < tx.validity_range.upper_bound
    }
  }
}
```

## Architecture

```mermaid
flowchart LR
    A[Script Hash<br/>or CBOR] --> B[Decode<br/>UPLC]
    B --> C[Parse &<br/>Analyze]
    C --> D[Generate<br/>Aiken Code]

    style A fill:#e3f2fd,stroke:#1976d2,stroke-width:2px,color:#000
    style B fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#000
    style C fill:#fff3e0,stroke:#f57c00,stroke-width:2px,color:#000
    style D fill:#e8f5e9,stroke:#388e3c,stroke-width:2px,color:#000
```

## Packages

Three npm packages for programmatic use:

| Package | Description |
|---------|-------------|
| `@uplc/parser` | UPLC text → AST with Plutus V3 support (case/constr) |
| `@uplc/patterns` | AST → Contract structure (purpose, datum, redeemer, checks) |
| `@uplc/codegen` | Structure → Aiken code with proper imports and types |

## Development

```bash
pnpm install
pnpm dev          # localhost:4321
pnpm build        # production build
pnpm test         # run all tests
```

### Project Structure

```
packages/
  parser/      # UPLC text parser
  patterns/    # Contract pattern recognition  
  codegen/     # Aiken code generation + stdlib mapping
src/
  lib/         # Decompiler helper, frontend utils
  components/  # React components
```

### Testing

```bash
# Run all package tests
pnpm test

# Individual packages
cd packages/parser && pnpm test
cd packages/patterns && pnpm test
cd packages/codegen && pnpm test
```

## How It Works

1. **Decode** — CBOR wrapper → Flat encoding → UPLC AST
2. **Analyze** — Detect purpose, extract datum/redeemer structure, find checks
3. **Generate** — Emit valid Aiken with types, imports, and idiomatic syntax

## License

MIT

---

<sub>Free to use. [Sponsors welcome](https://github.com/sponsors/will-break-it).</sub>
