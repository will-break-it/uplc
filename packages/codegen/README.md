# @uplc/codegen

Aiken code generation from contract structure.

## Usage

```typescript
import { parseUplc } from '@uplc/parser';
import { analyzeContract } from '@uplc/patterns';
import { generate } from '@uplc/codegen';

const ast = parseUplc(uplcText);
const structure = analyzeContract(ast);
const aikenCode = generate(structure);
```

## API

### `generate(structure: ContractStructure): string`

Generates Aiken source code with:
- Type definitions (Datum, Action enums)
- Validator with correct V3 signature
- Required imports
- Builtin → stdlib mapping

## Output Example

```aiken
validator decompiled_validator {
  spend(datum: Option<Datum>, redeemer: Action, own_ref: OutputReference, tx: Transaction) {
    when redeemer is {
      Cancel -> list.has(tx.extra_signatories, datum.owner)
      Claim -> datum.deadline < tx.validity_range.upper_bound
    }
  }
}
```

## Builtin Mapping

Maps UPLC builtins to idiomatic Aiken:

| UPLC | Aiken |
|------|-------|
| `equalsInteger` | `==` |
| `lessThanInteger` | `<` |
| `appendByteString` | `bytearray.concat()` |
| `headList` | `list.head()` |
| `ifThenElse` | `if/else` or `when/is` |

See `src/stdlib.ts` for complete mapping.

## Validator Signatures

Plutus V3 handler signatures:
- `spend(datum?, redeemer, output_ref, tx)`
- `mint(redeemer, policy_id, tx)`
- `withdraw(redeemer, credential, tx)`
- `publish(redeemer, certificate, tx)`
- `vote(redeemer, voter, governance_action_id, tx)`
- `propose(redeemer, proposal, tx)`
