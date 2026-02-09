# @uplc/parser

UPLC parser and AST converter with full Plutus V3 support.

## Usage

### From CBOR (Recommended)

Use `convertFromHarmoniclabs` for the cleanest pipeline from on-chain scripts:

```typescript
import { UPLCDecoder } from '@harmoniclabs/uplc';
import { convertFromHarmoniclabs } from '@uplc/parser';

// CBOR hex → harmoniclabs AST → our AST (direct, no text round-trip)
const buffer = hexToBytes(cborHex);
const program = UPLCDecoder.parse(buffer, 'flat');
const ast = convertFromHarmoniclabs(program.body);
```

### From UPLC Text

Use `parseUplc` when you have UPLC text (e.g., from Aiken compiler output):

```typescript
import { parseUplc } from '@uplc/parser';

const ast = parseUplc('(lam x (lam y [[(force (builtin addInteger)) x] y]))');
```

## API

### `convertFromHarmoniclabs(term: UPLCTerm): UplcTerm`

Converts a `@harmoniclabs/uplc` AST to our typed AST format. This is the preferred method for processing on-chain scripts as it avoids the text serialization/parsing round-trip.

### `parseUplc(text: string): UplcTerm`

Parses UPLC text into a typed AST. Throws `ParseError` on syntax errors.

## AST Types

```typescript
type UplcTerm =
  | { tag: 'lam'; param: string; body: UplcTerm }
  | { tag: 'app'; func: UplcTerm; arg: UplcTerm }
  | { tag: 'var'; name: string }
  | { tag: 'builtin'; name: string }
  | { tag: 'con'; type: string; value: UplcValue }
  | { tag: 'force'; term: UplcTerm }
  | { tag: 'delay'; term: UplcTerm }
  | { tag: 'error' }
  | { tag: 'case'; scrutinee: UplcTerm; branches: UplcTerm[] }  // V3
  | { tag: 'constr'; index: number; args: UplcTerm[] }          // V3

type UplcValue =
  | { tag: 'integer'; value: bigint }
  | { tag: 'bytestring'; value: Uint8Array }
  | { tag: 'string'; value: string }
  | { tag: 'bool'; value: boolean }
  | { tag: 'unit' }
  | { tag: 'list'; elementType: string; items: UplcValue[] }
  | { tag: 'pair'; fstType: string; sndType: string; fst: UplcValue; snd: UplcValue }
  | { tag: 'data'; value: PlutusData }
```

## Features

- **Direct CBOR conversion**: No text round-trip via `convertFromHarmoniclabs`
- **Plutus V3**: `case` and `constr` expressions
- **All builtins**: 85+ Plutus builtins (including BLS and bitwise operations)
- **Constants**: integers, bytestrings, strings, bools, unit, lists, pairs, data
- **De Bruijn → named variables**: Automatic variable naming (a, b, c, ...)
