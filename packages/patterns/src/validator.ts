/**
 * Validator Entry Point Detection
 * 
 * Detects whether a contract is a spend validator, minting policy, or unknown.
 * 
 * Spend validator: (lam datum (lam redeemer (lam ctx BODY)))
 * Minting policy: (lam redeemer (lam ctx BODY))
 */
import type { UplcTerm } from '@uplc/parser';

export interface ValidatorInfo {
  type: 'validator' | 'minting_policy' | 'unknown';
  params: string[];
  body: UplcTerm;
}

/**
 * Detect the validator entry point structure
 */
export function detectValidator(ast: UplcTerm): ValidatorInfo {
  const params: string[] = [];
  let current: UplcTerm = ast;
  
  // Unwrap nested lambdas
  while (current.tag === 'lam') {
    params.push(current.param);
    current = current.body;
  }
  
  // Determine type based on parameter count
  if (params.length >= 3) {
    return {
      type: 'validator',
      params: params.slice(0, 3),  // Take first 3: datum, redeemer, ctx
      body: current
    };
  } else if (params.length >= 2) {
    return {
      type: 'minting_policy',
      params: params.slice(0, 2),  // Take first 2: redeemer, ctx
      body: current
    };
  } else {
    return {
      type: 'unknown',
      params,
      body: current
    };
  }
}

/**
 * Get the redeemer parameter name from a validator
 */
export function getRedeemerParam(info: ValidatorInfo): string | undefined {
  if (info.type === 'validator' && info.params.length >= 2) {
    return info.params[1];  // Second param is redeemer
  } else if (info.type === 'minting_policy' && info.params.length >= 1) {
    return info.params[0];  // First param is redeemer
  }
  return undefined;
}

/**
 * Get the script context parameter name
 */
export function getContextParam(info: ValidatorInfo): string | undefined {
  if (info.type === 'validator' && info.params.length >= 3) {
    return info.params[2];
  } else if (info.type === 'minting_policy' && info.params.length >= 2) {
    return info.params[1];
  }
  return undefined;
}

/**
 * Get the datum parameter name (validators only)
 */
export function getDatumParam(info: ValidatorInfo): string | undefined {
  if (info.type === 'validator' && info.params.length >= 1) {
    return info.params[0];
  }
  return undefined;
}
