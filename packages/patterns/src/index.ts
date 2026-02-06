import type { UplcTerm } from '@uplc/parser';
import type { ContractStructure } from './types.js';
import { detectValidatorEntry } from './validator.js';
import { detectRedeemerVariants } from './redeemer.js';
import { detectChecks } from './checks.js';

export * from './types.js';
export { detectValidatorEntry } from './validator.js';
export { detectRedeemerVariants } from './redeemer.js';
export { detectChecks } from './checks.js';

/**
 * Analyze a UPLC contract and extract its structure
 */
export function analyzeContract(ast: UplcTerm): ContractStructure {
  // 1. Detect validator entry point
  const entry = detectValidatorEntry(ast);
  
  // 2. Find redeemer parameter (second-to-last for validators)
  const redeemerParam = entry.type === 'validator' && entry.params.length >= 2
    ? entry.params[1]  // datum, redeemer, ctx
    : entry.params[0]; // redeemer, ctx for minting
  
  // 3. Detect redeemer variants
  const redeemer = redeemerParam 
    ? detectRedeemerVariants(entry.body, redeemerParam)
    : { variants: [], matchPattern: 'unknown' as const };
  
  // 4. Detect validation checks
  const checks = detectChecks(entry.body);
  
  return {
    type: entry.type,
    params: entry.params,
    redeemer,
    checks,
    body: entry.body,
  };
}
