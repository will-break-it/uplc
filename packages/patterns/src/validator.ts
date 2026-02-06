import type { UplcTerm } from '@uplc/parser';

/**
 * Validator entry point info
 */
export interface ValidatorEntry {
  type: 'validator' | 'minting_policy' | 'unknown';
  params: string[];
  body: UplcTerm;
}

/**
 * Detect validator entry point pattern.
 * 
 * Spend validator: (lam datum (lam redeemer (lam ctx BODY)))
 * Minting policy: (lam redeemer (lam ctx BODY))
 */
export function detectValidatorEntry(term: UplcTerm): ValidatorEntry {
  const params: string[] = [];
  let current = term;
  
  // Unwrap nested lambdas
  while (current.tag === 'lam') {
    params.push(current.param);
    current = current.body;
  }
  
  // Determine type based on param count
  let type: 'validator' | 'minting_policy' | 'unknown';
  if (params.length >= 3) {
    type = 'validator';
  } else if (params.length === 2) {
    type = 'minting_policy';
  } else {
    type = 'unknown';
  }
  
  return {
    type,
    params,
    body: current,
  };
}

/**
 * Find a variable by name in a term
 */
export function findVariable(term: UplcTerm, name: string): boolean {
  switch (term.tag) {
    case 'var':
      return term.name === name;
    case 'lam':
      return findVariable(term.body, name);
    case 'app':
      return findVariable(term.func, name) || findVariable(term.arg, name);
    case 'force':
    case 'delay':
      return findVariable(term.term, name);
    default:
      return false;
  }
}
