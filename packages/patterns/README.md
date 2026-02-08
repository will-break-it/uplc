# @uplc/patterns

Contract structure extraction from UPLC AST.

## Usage

```typescript
import { parseUplc } from '@uplc/parser';
import { analyzeContract } from '@uplc/patterns';

const ast = parseUplc(uplcText);
const structure = analyzeContract(ast);

structure.type        // 'spend' | 'mint' | 'withdraw' | 'publish' | 'vote' | 'propose'
structure.params      // ['datum', 'redeemer', 'ctx']
structure.datum       // { isUsed, fields, isOptional }
structure.redeemer    // { variants: [...] }
structure.checks      // validation patterns detected
```

## API

### `analyzeContract(ast: UplcTerm): ContractStructure`

Analyzes AST to extract:

- **Purpose**: Detects all 6 Plutus V3 script purposes from parameter count/structure
- **Datum**: Fields, types, optional status (spend validators)
- **Redeemer**: Variants from case/when expressions
- **Checks**: Signature, deadline, value, equality patterns
- **Utilities**: Aiken V3 wrapper detection and builtin binding extraction

## Types

```typescript
interface ContractStructure {
  type: ScriptPurpose;
  params: string[];
  datum: DatumInfo;
  redeemer: RedeemerInfo;
  checks: ValidationCheck[];
  rawBody: UplcTerm;
  utilities: string[];           // V3 utility bindings
  utilityBindings: Record<string, string>;  // var → builtin mapping
}
```

## Pattern Detection

Recognizes common Cardano validation patterns:
- Signature verification (`verifyEd25519Signature`)
- Time bounds (`lessThan` on validity range)
- Value/token checks
- Datum continuity
