# @uplc/patterns

Contract structure extraction from UPLC AST.

## Usage

```typescript
import { UPLCDecoder } from '@harmoniclabs/uplc';
import { convertFromHarmoniclabs } from '@uplc/parser';
import { analyzeContract } from '@uplc/patterns';

// From on-chain CBOR (recommended)
const program = UPLCDecoder.parse(cborBytes, 'flat');
const ast = convertFromHarmoniclabs(program.body);
const structure = analyzeContract(ast);

structure.type              // 'spend' | 'mint' | 'withdraw' | 'publish' | 'vote' | 'propose'
structure.params            // ['datum', 'redeemer', 'ctx']
structure.datum             // { isUsed, fields, isOptional }
structure.redeemer          // { variants: [...], matchPattern }
structure.checks            // validation patterns detected
structure.scriptParams      // top-level hardcoded parameters
structure.utilityBindings   // V3 builtin bindings (b → tailList, etc.)
```

## API

### `analyzeContract(ast: UplcTerm): ContractStructure`

Full contract analysis. Extracts:

- **Purpose**: All 6 Plutus V3 script types via parameter count + body analysis
- **Datum**: Field access patterns, optional status (V3 inline datums)
- **Redeemer**: Variant detection from `case`, `ifThenElse`, or `chooseData` patterns
- **Checks**: Semantic classification of validation patterns
- **Script params**: Top-level hardcoded constants (policy IDs, hashes)
- **V3 utilities**: Aiken wrapper detection and builtin binding extraction

### `inferPurpose(body: UplcTerm): ScriptPurpose`

Analyzes body patterns when parameter count is ambiguous (e.g., 2-param could be mint or withdraw).

### `findValidationChecks(term: UplcTerm): ValidationCheck[]`

Extracts validation patterns with semantic classification.

## Types

```typescript
interface ContractStructure {
  type: ScriptPurpose;
  params: string[];
  datum: DatumInfo;
  redeemer: RedeemerInfo;
  checks: ValidationCheck[];
  rawBody: UplcTerm;
  utilities?: UplcTerm;
  utilityBindings?: Record<string, string>;
  scriptParams?: ScriptParameter[];
}

interface ValidationCheck {
  type: 'signer' | 'deadline' | 'token' | 'value' | 'owner' | 'equality' | 'comparison';
  builtin: string;
  description: string;
  location: UplcTerm;
}

interface RedeemerInfo {
  variants: RedeemerVariant[];
  matchPattern: 'constructor' | 'integer' | 'unknown';
}
```

## Redeemer Pattern Detection

Recognizes three constructor matching patterns:

**1. Plutus V3 case/constr** (most reliable):
```
(case (unConstrData redeemer) branch_0 branch_1 ...)
```

**2. Classic ifThenElse**:
```
(ifThenElse (equalsInteger (fstPair (unConstrData redeemer)) 0) branch_0 else)
```

**3. chooseData** (type dispatch):
```
(chooseData data constr_branch map_branch list_branch int_branch bytes_branch)
```

## Check Classification

Validation checks are semantically classified:

| Type | Description | Detected Via |
|------|-------------|--------------|
| `signer` | Signatory or signature checks | `verifyEd25519Signature`, list membership on `extra_signatories` |
| `deadline` | Time-bound validation | Comparisons on `validity_range` |
| `token` | Policy ID or token checks | `equalsByteString` on 28-byte values |
| `value` | Value comparisons | Comparisons involving value lookups |
| `owner` | Owner/authority checks | PKH equality comparisons |
| `equality` | General equality | Other equality builtins |
| `comparison` | Numeric comparisons | `lessThan*`, `lessThanEquals*` |

## Purpose Detection

All 6 Plutus V3 purposes detected via parameter structure:

| Purpose | Params | Signature |
|---------|--------|-----------|
| `spend` | 3-4 | `datum?, redeemer, output_ref, tx` |
| `mint` | 2 | `redeemer, policy_id, tx` |
| `withdraw` | 2 | `redeemer, credential, tx` |
| `publish` | 2 | `redeemer, certificate, tx` |
| `vote` | 3 | `redeemer, voter, governance_action_id, tx` |
| `propose` | 2 | `redeemer, proposal, tx` |

When parameter count is ambiguous (e.g., 2-param scripts), body patterns are analyzed:
- Minting policies use `ownCurrencySymbol` or token minting builtins
- Withdraw uses staking-related patterns
