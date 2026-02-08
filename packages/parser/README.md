# @uplc/parser

UPLC text → AST parser with full Plutus V3 support.

## Usage

```typescript
import { parseUplc } from '@uplc/parser';

const ast = parseUplc('(lam x (lam y (force (builtin addInteger) x y)))');
```

## API

### `parseUplc(text: string): UplcTerm`

Parses UPLC text into a typed AST. Throws on syntax errors.

### AST Types

```typescript
type UplcTerm =
  | { tag: 'lam'; param: string; body: UplcTerm }
  | { tag: 'app'; func: UplcTerm; arg: UplcTerm }
  | { tag: 'var'; name: string }
  | { tag: 'builtin'; name: string }
  | { tag: 'con'; value: UplcConst }
  | { tag: 'force'; term: UplcTerm }
  | { tag: 'delay'; term: UplcTerm }
  | { tag: 'error' }
  | { tag: 'case'; scrutinee: UplcTerm; branches: UplcTerm[] }  // V3
  | { tag: 'constr'; index: number; args: UplcTerm[] }          // V3
```

## Features

- **Plutus V3**: `case` and `constr` expressions
- **All builtins**: 60+ Plutus builtins recognized
- **Constants**: integers, bytestrings, strings, bools, unit, lists, pairs, data
