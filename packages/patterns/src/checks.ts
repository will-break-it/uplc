/**
 * Validation Check Detection
 * 
 * Identifies common validation patterns in smart contracts:
 * - Signature checks (verifyEd25519Signature, equalsByteString on signatories)
 * - Deadline checks (lessThanInteger on validity range)
 * - Value checks (comparison on values)
 * - General equality/comparison checks
 */
import type { UplcTerm } from '@uplc/parser';
import type { ValidationCheck } from './types.js';
import { findAll, getBuiltinName } from './traversal.js';

/**
 * Find all validation checks in a term
 */
export function findValidationChecks(term: UplcTerm): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  
  // Find all builtin applications
  const builtinApps = findAll(term, t => {
    if (t.tag !== 'app') return false;
    return getBuiltinName(t.func) !== undefined;
  });
  
  for (const app of builtinApps) {
    const check = classifyCheck(app);
    if (check) {
      checks.push(check);
    }
  }
  
  // Deduplicate by location (same AST node)
  const seen = new Set<UplcTerm>();
  return checks.filter(c => {
    if (seen.has(c.location)) return false;
    seen.add(c.location);
    return true;
  });
}

/**
 * Classify a builtin application as a validation check
 */
function classifyCheck(term: UplcTerm): ValidationCheck | undefined {
  if (term.tag !== 'app') return undefined;
  
  const builtinName = getBuiltinName(term.func);
  if (!builtinName) return undefined;
  
  // Signature verification
  if (builtinName === 'verifyEd25519Signature' || builtinName === 'verifySchnorrSecp256k1Signature') {
    return {
      type: 'signature',
      builtin: builtinName,
      description: `Verifies a cryptographic signature using ${builtinName}`,
      location: term
    };
  }
  
  // Equality checks
  if (builtinName === 'equalsByteString') {
    // Could be signature check (comparing against signatories) or general equality
    return {
      type: 'signature',  // Often used for PKH comparison
      builtin: builtinName,
      description: 'Compares two byte strings (possibly checking signature/PKH)',
      location: term
    };
  }
  
  if (builtinName === 'equalsInteger') {
    return {
      type: 'equality',
      builtin: builtinName,
      description: 'Compares two integers for equality',
      location: term
    };
  }
  
  if (builtinName === 'equalsData') {
    return {
      type: 'equality',
      builtin: builtinName,
      description: 'Compares two data values for equality',
      location: term
    };
  }
  
  // Comparisons
  if (builtinName === 'lessThanInteger') {
    return {
      type: 'comparison',
      builtin: builtinName,
      description: 'Checks if one integer is less than another (possibly deadline check)',
      location: term
    };
  }
  
  if (builtinName === 'lessThanEqualsInteger') {
    return {
      type: 'comparison',
      builtin: builtinName,
      description: 'Checks if one integer is less than or equal to another',
      location: term
    };
  }
  
  if (builtinName === 'lessThanByteString' || builtinName === 'lessThanEqualsByteString') {
    return {
      type: 'comparison',
      builtin: builtinName,
      description: 'Compares byte strings lexicographically',
      location: term
    };
  }
  
  // Hash operations (often used in validation)
  if (builtinName === 'sha2_256' || builtinName === 'sha3_256' || builtinName === 'blake2b_256') {
    return {
      type: 'signature',
      builtin: builtinName,
      description: `Computes ${builtinName} hash`,
      location: term
    };
  }
  
  // Skip builtins that aren't validation checks
  // (list operations, pair operations, data constructors, etc.)
  const nonCheckBuiltins = [
    'addInteger', 'subtractInteger', 'multiplyInteger', 'divideInteger',
    'quotientInteger', 'remainderInteger', 'modInteger',
    'appendByteString', 'consByteString', 'sliceByteString',
    'lengthOfByteString', 'indexByteString',
    'appendString', 'encodeUtf8', 'decodeUtf8',
    'ifThenElse', 'chooseUnit', 'trace',
    'fstPair', 'sndPair', 'mkPairData',
    'mkNilData', 'mkNilPairData', 'mkCons',
    'headList', 'tailList', 'nullList', 'chooseList',
    'constrData', 'mapData', 'listData', 'iData', 'bData',
    'unConstrData', 'unMapData', 'unListData', 'unIData', 'unBData',
    'equalsString', 'chooseData', 'serialiseData'
  ];
  
  if (nonCheckBuiltins.includes(builtinName)) {
    return undefined;
  }
  
  // Unknown builtin that looks like a check
  return {
    type: 'unknown',
    builtin: builtinName,
    description: `Uses builtin ${builtinName}`,
    location: term
  };
}

/**
 * Analyze if a check is related to a deadline
 * (Looks for access to validity_range fields)
 */
export function isDeadlineRelated(check: ValidationCheck, contextParam: string): boolean {
  if (check.type !== 'comparison') return false;
  
  // Would need to trace if the comparison involves validity_range access
  // For now, return false - this can be enhanced later
  return false;
}

/**
 * Analyze if a check is related to value
 * (Looks for value-related field access)
 */
export function isValueRelated(check: ValidationCheck): boolean {
  if (check.type !== 'comparison' && check.type !== 'equality') return false;
  
  // Would need to trace if the comparison involves value access
  // For now, return false - this can be enhanced later
  return false;
}
