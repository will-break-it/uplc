# @uplc/parser

UPLC text parser with full Plutus V3 support.

## What It Does

Converts UPLC text representation into an Abstract Syntax Tree (AST) that can be analyzed and transformed.

## Architecture

```mermaid
flowchart LR
    A[UPLC Text] --> B[Tokenizer]
    B --> C[Parser]
    C --> D[AST]

    style A fill:#e3f2fd,stroke:#1976d2,stroke-width:2px,color:#000
    style B fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px,color:#000
    style C fill:#fff3e0,stroke:#f57c00,stroke-width:2px,color:#000
    style D fill:#e8f5e9,stroke:#388e3c,stroke-width:2px,color:#000
```

## Input/Output

- **Input**: UPLC text (string)
  - Supports Plutus V1, V2, and V3
  - Handles case/constr expressions (V3)
  - Supports all builtin functions

- **Output**: Abstract Syntax Tree (AST)
  - Typed nodes: Force, Delay, Lambda, Apply, Variable, Builtin, Constant, Error, Case, Constr
  - Preserves structure for analysis

## Usage

```typescript
import { parseUplc } from '@uplc/parser';

const uplcText = `
(program 1.1.0
  (lam i_0
    (lam i_1
      (force (builtin ifThenElse)
        (builtin lessThanInteger (var i_1) (con integer 100))
        (con unit ())
        (error)))))
`;

const ast = parseUplc(uplcText);

// ast is a typed UplcTerm node that can be traversed and analyzed
```

## API Reference

### `parseUplc(text: string): UplcTerm`

Parses UPLC text into an AST.

**Throws**: `Error` if parsing fails (syntax errors, unknown builtins, etc.)

### AST Node Types

```typescript
type UplcTerm =
  | { type: 'force'; term: UplcTerm }
  | { type: 'delay'; term: UplcTerm }
  | { type: 'lambda'; argName: string; body: UplcTerm }
  | { type: 'apply'; func: UplcTerm; arg: UplcTerm }
  | { type: 'variable'; name: string }
  | { type: 'builtin'; name: string }
  | { type: 'constant'; value: any; constantType: string }
  | { type: 'error' }
  | { type: 'case'; scrutinee: UplcTerm; branches: UplcTerm[] }
  | { type: 'constr'; tag: number; fields: UplcTerm[] }
```

## Features

- **Plutus V3 Support**: Full support for `case` and `constr` expressions
- **Error Recovery**: Provides clear error messages with line/column information
- **All Builtins**: Recognizes all Plutus builtin functions
- **Constants**: Handles integers, bytestrings, strings, booleans, units, lists, pairs, and data

## Development

```bash
pnpm install
pnpm test
```
