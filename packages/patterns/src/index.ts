/**
 * @uplc/patterns - UPLC Pattern Recognition
 * 
 * Analyzes UPLC AST to identify smart contract structures:
 * - Validator entry point detection (all 6 Plutus V3 purposes)
 * - Redeemer variant analysis
 * - Validation check identification
 * 
 * Supported script purposes:
 * - spend: UTxO spending validator
 * - mint: Minting/burning policy
 * - withdraw: Staking reward withdrawal
 * - publish: Certificate publishing
 * - vote: Governance voting (CIP-1694)
 * - propose: Governance proposals (CIP-1694)
 */

import type { UplcTerm } from '@uplc/parser';
import type { ContractStructure, RedeemerInfo, RedeemerVariant, ValidationCheck, FieldInfo, ScriptPurpose } from './types.js';
import { detectValidator, getRedeemerParam } from './validator.js';
import { analyzeRedeemer } from './redeemer.js';
import { findValidationChecks } from './checks.js';

// Re-export types
export type { 
  ContractStructure, 
  RedeemerInfo, 
  RedeemerVariant, 
  ValidationCheck,
  FieldInfo,
  ScriptPurpose
} from './types.js';

// Re-export utilities for advanced usage
export { detectValidator, getRedeemerParam, getContextParam, getDatumParam } from './validator.js';
export type { ValidatorInfo } from './validator.js';
export { analyzeRedeemer } from './redeemer.js';
export { findValidationChecks } from './checks.js';
export * from './traversal.js';

/**
 * Analyze a UPLC AST to extract contract structure
 * 
 * @param ast - The parsed UPLC term
 * @returns Contract structure analysis
 * 
 * @example
 * ```typescript
 * import { parseUplc } from '@uplc/parser';
 * import { analyzeContract } from '@uplc/patterns';
 * 
 * const source = '(lam d (lam r (lam ctx (con unit ()))))';
 * const ast = parseUplc(source);
 * const structure = analyzeContract(ast);
 * 
 * console.log(structure.type);     // 'spend'
 * console.log(structure.params);   // ['d', 'r', 'ctx']
 * ```
 */
export function analyzeContract(ast: UplcTerm): ContractStructure {
  // Detect validator entry point (handles both V3 and simple patterns)
  const validator = detectValidator(ast);
  
  // Get the redeemer parameter name
  const redeemerParam = getRedeemerParam(validator);
  
  // Analyze redeemer patterns
  const redeemer = analyzeRedeemer(validator.body, redeemerParam);
  
  // Find validation checks in the body
  const checks = findValidationChecks(validator.body);
  
  return {
    type: validator.type,
    params: validator.params,
    redeemer,
    checks,
    rawBody: validator.body,
    utilities: validator.utilities
  };
}
