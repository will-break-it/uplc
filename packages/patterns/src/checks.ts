/**
 * Validation Check Detection
 * 
 * Identifies and classifies validation patterns in smart contracts:
 * - signer: Checking signatories or verifying signatures
 * - deadline: Time-based checks on validity range
 * - token: Policy ID or token amount checks
 * - value: ADA or native token value comparisons
 * - datum: Datum field comparisons
 * - owner: Owner/authority checks (PKH comparisons)
 * - equality: General equality checks
 * - comparison: General numeric comparisons
 */
import type { UplcTerm } from '@uplc/parser';
import type { ValidationCheck } from './types.js';
import { findAll, flattenApp, getBuiltinName, referencesVar } from './traversal.js';

/**
 * Find all validation checks in a term, with semantic classification
 */
export function findValidationChecks(term: UplcTerm): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const seen = new Set<UplcTerm>();

  // Find all builtin applications that look like checks
  const builtinApps = findAll(term, t => {
    if (t.tag !== 'app') return false;
    const builtin = getBuiltinName(t.func);
    return builtin !== undefined && isCheckBuiltin(builtin);
  });

  for (const app of builtinApps) {
    if (seen.has(app)) continue;
    seen.add(app);
    
    const check = classifyCheck(app, term);
    if (check) {
      checks.push(check);
    }
  }
  
  return checks;
}

/**
 * Check if a builtin is used for validation (vs data manipulation)
 */
function isCheckBuiltin(builtin: string): boolean {
  const checkBuiltins = [
    // Equality
    'equalsInteger', 'equalsByteString', 'equalsData', 'equalsString',
    // Comparison
    'lessThanInteger', 'lessThanEqualsInteger',
    'lessThanByteString', 'lessThanEqualsByteString',
    // Crypto
    'verifyEd25519Signature', 'verifyEcdsaSecp256k1Signature', 
    'verifySchnorrSecp256k1Signature',
    // Hashing (often part of checks)
    'sha2_256', 'sha3_256', 'blake2b_256', 'blake2b_224', 'keccak_256'
  ];
  
  return checkBuiltins.includes(builtin);
}

/**
 * Classify a check based on context analysis
 */
function classifyCheck(app: UplcTerm, fullBody: UplcTerm): ValidationCheck | undefined {
  if (app.tag !== 'app') return undefined;
  
  const parts = flattenApp(app);
  const builtin = getBuiltinName(parts[0]);
  if (!builtin) return undefined;
  
  // Get arguments
  const args = parts.slice(1);
  
  // Signature verification is always 'signer'
  if (builtin.includes('verify') && builtin.includes('Signature')) {
    return {
      type: 'signer',
      builtin,
      description: `Cryptographic signature verification (${builtin})`,
      location: app
    };
  }
  
  // Hash functions are typically part of signature/integrity checks
  if (['sha2_256', 'sha3_256', 'blake2b_256', 'blake2b_224', 'keccak_256'].includes(builtin)) {
    return {
      type: 'signer',
      builtin,
      description: `Hash computation (${builtin}) - likely for integrity check`,
      location: app
    };
  }
  
  // Analyze comparison arguments for semantic meaning
  if (builtin === 'equalsByteString' || builtin === 'lessThanByteString' || 
      builtin === 'lessThanEqualsByteString') {
    const semanticType = classifyByteStringComparison(args, fullBody);
    return {
      type: semanticType,
      builtin,
      description: describeByteStringCheck(semanticType, builtin),
      location: app
    };
  }
  
  if (builtin === 'equalsInteger' || builtin === 'lessThanInteger' || 
      builtin === 'lessThanEqualsInteger') {
    const semanticType = classifyIntegerComparison(args, fullBody);
    return {
      type: semanticType,
      builtin,
      description: describeIntegerCheck(semanticType, builtin),
      location: app
    };
  }
  
  if (builtin === 'equalsData') {
    return {
      type: 'equality',
      builtin,
      description: 'Data equality check',
      location: app
    };
  }
  
  // Default
  return {
    type: 'unknown',
    builtin,
    description: `Validation using ${builtin}`,
    location: app
  };
}

/**
 * Classify a byte string comparison based on context
 */
function classifyByteStringComparison(
  args: UplcTerm[], 
  fullBody: UplcTerm
): ValidationCheck['type'] {
  // Check if any arg is derived from signatories
  for (const arg of args) {
    if (isSignatoryDerived(arg, fullBody)) {
      return 'signer';
    }
    if (isPolicyIdDerived(arg)) {
      return 'token';
    }
    if (isScriptHashDerived(arg)) {
      return 'owner';
    }
  }
  
  // Check for constant policy ID length (28 bytes = 56 hex chars)
  for (const arg of args) {
    if (isConstantOfLength(arg, 28)) {
      return 'token';  // Likely policy ID check
    }
    if (isConstantOfLength(arg, 28)) {
      return 'owner';  // Likely PKH or script hash
    }
  }
  
  return 'equality';
}

/**
 * Classify an integer comparison based on context
 */
function classifyIntegerComparison(
  args: UplcTerm[], 
  fullBody: UplcTerm
): ValidationCheck['type'] {
  // Check if any arg is derived from validity range
  for (const arg of args) {
    if (isValidityRangeDerived(arg)) {
      return 'deadline';
    }
    if (isValueAmountDerived(arg)) {
      return 'value';
    }
    if (isConstructorIndexCheck(arg)) {
      // This is redeemer variant check, not a validation check
      return 'equality';
    }
  }
  
  // Check if one arg is a large constant (likely timestamp)
  for (const arg of args) {
    if (isLargeIntConstant(arg)) {
      return 'deadline';  // Large int often = POSIX timestamp
    }
  }
  
  return 'comparison';
}

/**
 * Check if a term is derived from tx.signatories
 */
function isSignatoryDerived(term: UplcTerm, fullBody: UplcTerm): boolean {
  // Look for patterns like:
  // - elem(signer, tx.extra_signatories)
  // - headList/tailList chains from a list that's accessed from tx
  
  // Simple heuristic: if the term references a variable that has 'signatorie' in usage
  // For now, check if the parent contains list operations on the same data
  
  const parts = flattenApp(term);
  const builtin = getBuiltinName(parts[0]);
  
  // If extracted from a list via headList, check list source
  if (builtin === 'headList' || builtin === 'tailList') {
    // Traverse up to see if this comes from signatories
    // For now, return false - would need more sophisticated analysis
  }
  
  return false;
}

/**
 * Check if a term is a policy ID (from minting context)
 */
function isPolicyIdDerived(term: UplcTerm): boolean {
  // Check if term comes from unConstrData on script context minting field
  const parts = flattenApp(term);
  const builtin = getBuiltinName(parts[0]);
  
  // Policy IDs are typically fstPair of map entries in mint field
  if (builtin === 'fstPair') {
    return true;  // Could be policy ID
  }
  
  return false;
}

/**
 * Check if a term is a script hash (from continuing outputs)
 */
function isScriptHashDerived(term: UplcTerm): boolean {
  // Script hashes come from output addresses
  // Pattern: extracting credential from address
  return false;
}

/**
 * Check if a term is a constant bytestring of specific length
 */
function isConstantOfLength(term: UplcTerm, length: number): boolean {
  if (term.tag !== 'con') return false;
  if (term.type !== 'bytestring') return false;
  
  const value = term.value;
  if (value?.tag === 'bytestring' && value.value instanceof Uint8Array) {
    return value.value.length === length;
  }
  
  return false;
}

/**
 * Check if a term is derived from validity range
 */
function isValidityRangeDerived(term: UplcTerm): boolean {
  // Validity range is accessed via:
  // - fstPair/sndPair on interval bounds
  // - unIData on the bound value
  
  const parts = flattenApp(term);
  const builtin = getBuiltinName(parts[0]);
  
  // Common pattern: unIData(fstPair(unConstrData(bound)))
  if (builtin === 'unIData' && parts.length >= 2) {
    // Could be validity range
    return false;  // Need more context
  }
  
  return false;
}

/**
 * Check if a term is derived from a value amount
 */
function isValueAmountDerived(term: UplcTerm): boolean {
  // Values are typically accessed via:
  // - unMapData on value
  // - looking up policy ID, then token name
  
  const parts = flattenApp(term);
  const builtin = getBuiltinName(parts[0]);
  
  // Arithmetic on integers often indicates value calculations
  if (['addInteger', 'subtractInteger', 'multiplyInteger', 'divideInteger'].includes(builtin || '')) {
    return true;
  }
  
  return false;
}

/**
 * Check if term is a constructor index check (redeemer matching)
 */
function isConstructorIndexCheck(term: UplcTerm): boolean {
  const parts = flattenApp(term);
  const builtin = getBuiltinName(parts[0]);
  
  if (builtin === 'fstPair' && parts.length >= 2) {
    const innerParts = flattenApp(parts[1]);
    const innerBuiltin = getBuiltinName(innerParts[0]);
    if (innerBuiltin === 'unConstrData') {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if term is a large integer constant (likely timestamp)
 */
function isLargeIntConstant(term: UplcTerm): boolean {
  if (term.tag !== 'con') return false;
  
  const value = term.value;
  if (value?.tag === 'integer') {
    const n = value.value;
    // POSIX timestamps are ~1700000000000 (13 digits)
    // Slot numbers are ~100000000 (9 digits)
    return n > 1000000000n;
  }
  
  return false;
}

/**
 * Generate description for byte string check
 */
function describeByteStringCheck(type: ValidationCheck['type'], builtin: string): string {
  switch (type) {
    case 'signer':
      return 'Checks if a public key hash is in signatories';
    case 'token':
      return 'Compares policy ID or token name';
    case 'owner':
      return 'Checks script/credential ownership';
    default:
      return `Byte string comparison (${builtin})`;
  }
}

/**
 * Generate description for integer check
 */
function describeIntegerCheck(type: ValidationCheck['type'], builtin: string): string {
  switch (type) {
    case 'deadline':
      return 'Deadline/timelock check against validity range';
    case 'value':
      return 'Value/amount comparison';
    default:
      return `Integer ${builtin === 'equalsInteger' ? 'equality' : 'comparison'} check`;
  }
}

/**
 * Analyze if a check is related to a deadline
 */
export function isDeadlineRelated(check: ValidationCheck, contextParam: string): boolean {
  return check.type === 'deadline';
}

/**
 * Analyze if a check is related to value
 */
export function isValueRelated(check: ValidationCheck): boolean {
  return check.type === 'value';
}
