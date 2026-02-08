# UPLC Decompiler Improvements

## Completed

- [x] Utility binding resolution (`h(x)` → `chooseList(x)`)
- [x] Lambda flattening (`fn(a) { fn(b) {...}}` → `fn(a, b) {...}`)
- [x] Tail chain simplification (`x.tail().tail()...head()` → `list.at(x, 8)`)
- [x] V3 pattern detection (Aiken wrapper unwrapping)
- [x] BLS12-381 builtin support
- [x] Depth limit increase (500 → 1000)
- [x] Trace string extraction from bytecode
- [x] AI rewrite with Opus model
- [x] Remove client-side caching (KV only)

## Codegen Improvements

### High Priority

- [ ] **Datum structure inference**
  - Detect `unConstrData` + field access patterns
  - Generate type definitions: `type Datum { field1: Int, field2: ByteArray }`
  - Track which fields are accessed and their types
  - Test: Contract with known datum structure (e.g., escrow with owner/deadline/amount)

- [ ] **Redeemer variant detection**
  - Parse `constr` index checks to identify variants
  - Generate: `type Redeemer { Unlock | Cancel | Extend(Int) }`
  - Map branches to variant handlers
  - Test: Multi-action validator (mint/burn, lock/unlock)

- [ ] **Transaction field extraction**
  - Recognize ScriptContext unpacking patterns
  - Map to readable: `tx.inputs`, `tx.outputs`, `tx.signatories`, `tx.validity_range`
  - Detect common checks: `list.has(tx.signatories, owner)`
  - Test: Signature-checking validator

### Medium Priority

- [ ] **Recursive function detection**
  - Identify Y-combinator / fix-point patterns
  - Transform to: `list.fold`, `list.map`, `list.filter`, `list.find`
  - Detect self-referential lambdas
  - Test: Contract with list iteration

- [ ] **Constants extraction**
  - Extract policy IDs, script hashes, amounts
  - Generate named constants at top: `const POLICY_ID = #"abc123..."`
  - Detect magic numbers and label them
  - Test: Minting policy with hardcoded policy ID

- [ ] **Pair destructuring**
  - `fstPair(unConstrData(x))` → `x.tag`
  - `sndPair(unConstrData(x))` → `x.fields`
  - Chain: `headList(sndPair(...))` → `x.fields[0]`
  - Test: Contract with constr pattern matching

### Lower Priority

- [ ] **Boolean simplification**
  - `ifThenElse(cond, True, False)` → `cond`
  - `ifThenElse(cond, False, True)` → `!cond`
  - Nested conditionals → `&&`, `||`
  - Test: Validator with complex boolean logic

- [ ] **Arithmetic patterns**
  - Detect percentage calculations: `(x * 100) / total`
  - Fee calculations: `amount - fee`
  - Comparisons: `lessThanInteger(a, b)` → `a < b`
  - Test: DEX with fee calculation

- [ ] **Error message correlation**
  - Link trace strings to validation branches
  - Show which check produces which error
  - Test: Contract with multiple trace messages

## Parser Improvements

- [ ] **Inline constant folding**
  - Evaluate pure arithmetic at parse time
  - Simplify: `(lam x (+ 1 1))` → `(lam x 2)`

- [ ] **Dead code elimination**
  - Remove unused lambda bindings
  - Simplify: `(lam x (lam y x))` applied → drop y

## Pattern Detection Improvements

- [ ] **Script purpose refinement**
  - Detect withdrawal vs stake registration
  - Identify governance (vote/propose) patterns
  - Detect multi-purpose validators

- [ ] **Protocol fingerprinting**
  - Expand known protocol signatures
  - Add Minswap V2, SundaeSwap V3 patterns
  - Detect common DEX pool structures

## Test Coverage

### Unit Tests (packages/codegen)

- [ ] Datum inference from unConstrData patterns
- [ ] Redeemer variant extraction
- [ ] Transaction field access patterns
- [ ] Recursive function transformation
- [ ] Boolean expression simplification
- [ ] Pair destructuring chains

### Integration Tests (packages/patterns)

- [ ] Real Minswap V2 pool contract
- [ ] Real SundaeSwap order contract
- [ ] Real JPG Store listing contract
- [ ] Real Liqwid supply contract
- [ ] Governance/voting contract
- [ ] Multi-validator script

### Edge Cases

- [ ] Empty validator (always true/false)
- [ ] Maximum nesting depth
- [ ] Unusual builtin combinations
- [ ] Malformed/invalid UPLC recovery

## Performance

- [ ] Lazy AST traversal for large contracts
- [ ] Streaming decompilation for huge scripts
- [ ] Worker thread for CPU-heavy parsing

## Documentation

- [ ] Document transformation pipeline
- [ ] Add examples for each pattern type
- [ ] Explain AI prompt engineering decisions
