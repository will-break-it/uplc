/**
 * High-Level Pattern Detection
 * 
 * Detects UPLC patterns that map to Aiken stdlib or language constructs:
 * - Transaction field access (tx.inputs, tx.outputs, etc.)
 * - List operations (list.find, list.map, list.filter)
 * - Option handling (Some/None patterns)
 * - Constructor matching (when/is patterns)
 * - Boolean combinations (and/or chains)
 * 
 * These patterns span multiple builtins and need structural analysis.
 */

import type { UplcTerm } from '@uplc/parser';

/**
 * A detected high-level pattern
 */
export interface DetectedPattern {
  kind: PatternKind;
  replacement: string;
  consumedNodes: Set<UplcTerm>;
}

export type PatternKind =
  | 'tx_field'        // tx.inputs, tx.outputs, etc.
  | 'datum_field'     // datum.field_0, datum.owner, etc.
  | 'redeemer_match'  // when redeemer is { ... }
  | 'list_find'       // list.find(lst, pred)
  | 'list_any'        // list.any(lst, pred)
  | 'list_all'        // list.all(lst, pred)
  | 'list_map'        // list.map(lst, fn)
  | 'list_filter'     // list.filter(lst, pred)
  | 'list_fold'       // list.foldr(lst, acc, fn)
  | 'list_member'     // list.has(lst, elem)
  | 'option_some'     // Some(x)
  | 'option_none'     // None
  | 'option_unwrap'   // expect Some(x) = opt
  | 'constr_match'    // when x is { 0 -> ..., 1 -> ... }
  | 'and_chain'       // a && b && c
  | 'or_chain';       // a || b || c

/**
 * Transaction field access by index (V3 layout)
 */
export const TX_FIELDS: Record<number, string> = {
  0: 'inputs',
  1: 'reference_inputs',
  2: 'outputs',
  3: 'fee',
  4: 'mint',
  5: 'certificates',
  6: 'withdrawals',
  7: 'validity_range',
  8: 'extra_signatories',
  9: 'redeemers',
  10: 'datums',
  11: 'id',
  12: 'votes',
  13: 'proposal_procedures',
  14: 'current_treasury_amount',
  15: 'treasury_donation',
};

/**
 * Input/Output field access
 */
export const INPUT_FIELDS: Record<number, string> = {
  0: 'output_reference',
  1: 'output',
};

export const OUTPUT_FIELDS: Record<number, string> = {
  0: 'address',
  1: 'value',
  2: 'datum',
  3: 'reference_script',
};

export const OUTPUT_REFERENCE_FIELDS: Record<number, string> = {
  0: 'transaction_id',
  1: 'output_index',
};

export const ADDRESS_FIELDS: Record<number, string> = {
  0: 'payment_credential',
  1: 'stake_credential',
};

export const VALUE_OPERATIONS: Record<string, string> = {
  // Common value patterns
  'quantity_of': 'value.quantity_of(value, policy_id, asset_name)',
  'ada_quantity': 'value.lovelace_of(value)',
  'flatten': 'value.flatten(value)',
};

/**
 * Detect transaction field access pattern
 * Pattern: headList(tailList^n(sndPair(unConstrData(var))))
 * 
 * @param term The term to analyze
 * @param txVar The name of the transaction variable
 * @returns Field name if detected, null otherwise
 */
export function detectTxField(term: UplcTerm, txVar: string): string | null {
  // Start from headList
  if (!isBuiltinCall(term, 'headList')) return null;
  
  let current = getArg(term);
  if (!current) return null;
  
  // Count tailList applications
  let tailCount = 0;
  while (isBuiltinCall(current, 'tailList')) {
    tailCount++;
    current = getArg(current);
    if (!current) return null;
  }
  
  // Expect sndPair(unConstrData(txVar))
  if (!isBuiltinCall(current, 'sndPair')) return null;
  current = getArg(current);
  if (!current) return null;
  
  if (!isBuiltinCall(current, 'unConstrData')) return null;
  current = getArg(current);
  if (!current) return null;
  
  // Check if it's the tx variable
  if (current.tag === 'var' && current.name === txVar) {
    return TX_FIELDS[tailCount] || `field_${tailCount}`;
  }
  
  return null;
}

/**
 * Detect datum/redeemer field access pattern
 * Pattern: headList(tailList^n(sndPair(unConstrData(var))))
 */
export function detectDataField(term: UplcTerm, dataVar: string): { index: number; accessor: string } | null {
  if (!isBuiltinCall(term, 'headList')) return null;
  
  let current = getArg(term);
  if (!current) return null;
  
  let tailCount = 0;
  while (isBuiltinCall(current, 'tailList')) {
    tailCount++;
    current = getArg(current);
    if (!current) return null;
  }
  
  if (!isBuiltinCall(current, 'sndPair')) return null;
  current = getArg(current);
  if (!current) return null;
  
  if (!isBuiltinCall(current, 'unConstrData')) return null;
  current = getArg(current);
  if (!current) return null;
  
  if (current.tag === 'var' && current.name === dataVar) {
    return { 
      index: tailCount, 
      accessor: `${dataVar}.field_${tailCount}` 
    };
  }
  
  return null;
}

/**
 * Detect list.has pattern (membership check)
 * Pattern: recursive fold that checks equality and returns Bool
 */
export function detectListMembership(term: UplcTerm): { list: string; element: string } | null {
  // This is complex - typically involves a Y combinator fold
  // For now, detect simple patterns like:
  // find(lst, fn(x) { x == elem }) != None
  // or direct membership check patterns
  
  // TODO: Implement full detection
  return null;
}

/**
 * Detect and/or chain patterns
 * Pattern: ifThenElse(a, ifThenElse(b, True/c, False), False)
 */
export function detectBooleanChain(term: UplcTerm): { kind: 'and' | 'or'; operands: UplcTerm[] } | null {
  const operands: UplcTerm[] = [];
  let current = term;
  let kind: 'and' | 'or' | null = null;
  
  while (isBuiltinCall(current, 'ifThenElse')) {
    const args = getArgs(current);
    if (args.length !== 3) break;
    
    const [cond, thenBr, elseBr] = args;
    const thenVal = unwrapDelay(thenBr);
    const elseVal = unwrapDelay(elseBr);
    
    // AND pattern: if a then b else False
    if (isConstBool(elseVal, false)) {
      if (kind === null) kind = 'and';
      if (kind !== 'and') break;
      operands.push(cond);
      current = thenVal;
      continue;
    }
    
    // OR pattern: if a then True else b
    if (isConstBool(thenVal, true)) {
      if (kind === null) kind = 'or';
      if (kind !== 'or') break;
      operands.push(cond);
      current = elseVal;
      continue;
    }
    
    break;
  }
  
  // Add final operand
  if (operands.length > 0 && kind) {
    operands.push(current);
    return { kind, operands };
  }
  
  return null;
}

/**
 * Detect constructor matching pattern (when/is)
 * Pattern: ifThenElse(equalsInteger(fstPair(unConstrData(x)), N), ...)
 */
export function detectConstrMatch(term: UplcTerm): { 
  scrutinee: UplcTerm; 
  branches: Array<{ index: number; body: UplcTerm }>;
  default?: UplcTerm;
} | null {
  const branches: Array<{ index: number; body: UplcTerm }> = [];
  let scrutinee: UplcTerm | null = null;
  let current = term;
  
  while (isBuiltinCall(current, 'ifThenElse')) {
    const args = getArgs(current);
    if (args.length !== 3) break;
    
    const [cond, thenBr, elseBr] = args;
    
    // Check if condition is: equalsInteger(fstPair(unConstrData(x)), N)
    const constrCheck = parseConstrCheck(cond);
    if (!constrCheck) break;
    
    if (scrutinee === null) {
      scrutinee = constrCheck.scrutinee;
    }
    
    branches.push({
      index: constrCheck.index,
      body: unwrapDelay(thenBr)
    });
    
    current = unwrapDelay(elseBr);
  }
  
  if (branches.length > 0 && scrutinee) {
    return {
      scrutinee,
      branches,
      default: isError(current) ? undefined : current
    };
  }
  
  return null;
}

/**
 * Parse constructor index check
 */
function parseConstrCheck(term: UplcTerm): { scrutinee: UplcTerm; index: number } | null {
  if (!isBuiltinCall(term, 'equalsInteger')) return null;
  
  const args = getArgs(term);
  if (args.length !== 2) return null;
  
  // Find which arg is the constant and which is fstPair(unConstrData(x))
  for (let i = 0; i < 2; i++) {
    const maybeConst = args[i];
    const maybePattern = args[1 - i];
    
    const constVal = extractIntConstant(maybeConst);
    if (constVal === null) continue;
    
    const scrutinee = parseConstrAccess(maybePattern);
    if (!scrutinee) continue;
    
    return { scrutinee, index: Number(constVal) };
  }
  
  return null;
}

/**
 * Parse fstPair(unConstrData(x)) pattern
 */
function parseConstrAccess(term: UplcTerm): UplcTerm | null {
  if (!isBuiltinCall(term, 'fstPair')) return null;
  
  const inner = getArg(term);
  if (!inner || !isBuiltinCall(inner, 'unConstrData')) return null;
  
  return getArg(inner);
}

// ============ Utility Functions ============

function isBuiltinCall(term: UplcTerm | null, name: string): boolean {
  if (!term) return false;
  
  // Flatten application and forces
  let current = term;
  while (current.tag === 'app') {
    current = (current as any).func;
  }
  while (current.tag === 'force') {
    current = (current as any).term;
  }
  
  return current.tag === 'builtin' && current.name === name;
}

function getArgs(term: UplcTerm): UplcTerm[] {
  const args: UplcTerm[] = [];
  let current = term;
  
  while (current.tag === 'app') {
    args.unshift((current as any).arg);
    current = (current as any).func;
  }
  
  return args;
}

function getArg(term: UplcTerm): UplcTerm | null {
  if (term.tag !== 'app') return null;
  return (term as any).arg;
}

function unwrapDelay(term: UplcTerm): UplcTerm {
  while (term.tag === 'delay') {
    term = (term as any).term;
  }
  return term;
}

function isConstBool(term: UplcTerm, value: boolean): boolean {
  if (term.tag !== 'con') return false;
  const v = (term as any).value;
  return v?.tag === 'bool' && v.value === value;
}

function isError(term: UplcTerm): boolean {
  return term.tag === 'error';
}

function extractIntConstant(term: UplcTerm): bigint | null {
  if (term.tag !== 'con') return null;
  const v = (term as any).value;
  if (v?.tag === 'integer') return v.value;
  return null;
}

/**
 * Apply pattern detection to simplify a term
 */
export function simplifyWithPatterns(
  term: UplcTerm, 
  context: { txVar?: string; datumVar?: string; redeemerVar?: string }
): string | null {
  // Try tx field access
  if (context.txVar) {
    const txField = detectTxField(term, context.txVar);
    if (txField) return `tx.${txField}`;
  }
  
  // Try datum field access
  if (context.datumVar) {
    const datumField = detectDataField(term, context.datumVar);
    if (datumField) return datumField.accessor;
  }
  
  // Try boolean chain
  const boolChain = detectBooleanChain(term);
  if (boolChain && boolChain.operands.length > 1) {
    const op = boolChain.kind === 'and' ? ' && ' : ' || ';
    // Note: operands would need to be converted to strings recursively
    return null; // TODO: implement full recursion
  }
  
  return null;
}
