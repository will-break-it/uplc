/**
 * Helper Function Extraction & Common Pattern Detection
 * 
 * Identifies common UPLC patterns and extracts them as named helpers.
 * This runs before code generation to simplify the output.
 */

import type { UplcTerm } from '@uplc/parser';

/**
 * Extracted helper function
 */
export interface ExtractedHelper {
  /** Original variable name in the AST */
  originalName: string;
  /** Semantic helper name */
  helperName: string;
  /** Pattern type for categorization */
  pattern: HelperPattern;
  /** Whether this can be inlined (no side effects, simple) */
  canInline: boolean;
}

export type HelperPattern = 
  | 'identity'           // fn(x) { x }
  | 'apply'              // fn(f, x) { f(x) }
  | 'compose'            // fn(f, g, x) { f(g(x)) }
  | 'unwrap_constr'      // fn(x) { un_constr_data(x) }
  | 'expect_constr_0'    // fn(x) { if x.1st == 0 { x.2nd } else { fail } }
  | 'expect_constr_n'    // fn(x) { if x.1st == N { x.2nd } else { fail } }
  | 'unwrap_data'        // fn(x) { un_i_data(x) } or un_b_data, etc.
  | 'get_field_n'        // fn(x) { head(tail^n(snd(unconstr(x)))) }
  | 'unknown';

/**
 * Transaction field mapping (Plutus V3 layout)
 * Index -> field name in Aiken's Transaction type
 */
export const TX_FIELD_MAP: Record<number, string> = {
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
 * ScriptContext field mapping (V3 - context is a pair: (redeemer, scriptInfo))
 * After unpacking: scriptInfo has purpose + transaction
 */
export const SCRIPT_CONTEXT_MAP = {
  redeemer: 'fst',      // fstPair(ctx)
  scriptInfo: 'snd',    // sndPair(ctx) - contains purpose and tx
};

/**
 * Common builtin patterns that can be named
 */
export const BUILTIN_HELPERS: Record<string, string> = {
  'unIData': 'to_int',
  'unBData': 'to_bytearray', 
  'unListData': 'to_list',
  'unMapData': 'to_map',
  'unConstrData': 'to_constr',
  'iData': 'from_int',
  'bData': 'from_bytearray',
  'listData': 'from_list',
  'mapData': 'from_map',
  'constrData': 'from_constr',
};

/**
 * Analyze a lambda and determine if it matches a known helper pattern
 */
export function analyzeHelper(term: UplcTerm): ExtractedHelper | null {
  if (term.tag !== 'lam') return null;
  
  const pattern = detectPattern(term);
  if (!pattern) return null;
  
  return {
    originalName: '', // Set by caller
    helperName: patternToName(pattern),
    pattern: pattern.type,
    canInline: pattern.canInline,
  };
}

interface DetectedPattern {
  type: HelperPattern;
  canInline: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Detect which pattern a lambda matches
 */
function detectPattern(term: UplcTerm): DetectedPattern | null {
  if (term.tag !== 'lam') return null;
  
  const param = term.param;
  const body = term.body;
  
  // Identity: fn(x) { x }
  if (body.tag === 'var' && body.name === param) {
    return { type: 'identity', canInline: true };
  }
  
  // Check for nested lambdas
  if (body.tag === 'lam') {
    const innerParam = body.param;
    const innerBody = body.body;
    
    // Apply: fn(f, x) { f(x) }
    if (innerBody.tag === 'app' && 
        innerBody.func.tag === 'var' && innerBody.func.name === param &&
        innerBody.arg.tag === 'var' && innerBody.arg.name === innerParam) {
      return { type: 'apply', canInline: true };
    }
    
    // Compose with 3 params: fn(f, g, x) { f(g(x)) }
    if (innerBody.tag === 'lam') {
      const thirdParam = innerBody.param;
      const composeBody = innerBody.body;
      
      if (composeBody.tag === 'app' &&
          composeBody.func.tag === 'var' && composeBody.func.name === param &&
          composeBody.arg.tag === 'app' &&
          composeBody.arg.func.tag === 'var' && composeBody.arg.func.name === innerParam &&
          composeBody.arg.arg.tag === 'var' && composeBody.arg.arg.name === thirdParam) {
        return { type: 'compose', canInline: true };
      }
    }
  }
  
  // Unwrap constr: fn(x) { un_constr_data(x) }
  if (isBuiltinCall(body, 'unConstrData', [param])) {
    return { type: 'unwrap_constr', canInline: true };
  }
  
  // Unwrap data types: fn(x) { un_i_data(x) }, etc.
  for (const builtin of ['unIData', 'unBData', 'unListData', 'unMapData']) {
    if (isBuiltinCall(body, builtin, [param])) {
      return { type: 'unwrap_data', canInline: true, metadata: { builtin } };
    }
  }
  
  // Expect constr 0: fn(x) { let c = unconstr(x); if c.1st == 0 { c.2nd } else { fail } }
  const expectPattern = detectExpectConstr(term);
  if (expectPattern !== null) {
    return { 
      type: expectPattern === 0 ? 'expect_constr_0' : 'expect_constr_n',
      canInline: false,
      metadata: { index: expectPattern }
    };
  }
  
  return null;
}

/**
 * Check if a term is a builtin call with specific variable arguments
 */
function isBuiltinCall(term: UplcTerm, builtinName: string, expectedArgs: string[]): boolean {
  // Flatten the application
  const parts = flattenApp(term);
  if (parts.length !== expectedArgs.length + 1) return false;
  
  // Check builtin name (may be wrapped in force)
  const head = unwrapForces(parts[0]);
  if (head.tag !== 'builtin' || head.name !== builtinName) return false;
  
  // Check arguments
  for (let i = 0; i < expectedArgs.length; i++) {
    const arg = parts[i + 1];
    if (arg.tag !== 'var' || arg.name !== expectedArgs[i]) return false;
  }
  
  return true;
}

/**
 * Detect expect Constr N pattern:
 * fn(x) { 
 *   let c = un_constr_data(x)
 *   if fst(c) == N { snd(c) } else { fail }
 * }
 * 
 * Returns the constructor index N, or null if not matching
 */
function detectExpectConstr(term: UplcTerm): number | null {
  if (term.tag !== 'lam') return null;
  
  const body = term.body;
  
  // Look for ifThenElse pattern
  const ifPattern = matchIfThenElse(body);
  if (!ifPattern) return null;
  
  // Check condition is: equalsInteger(fstPair(unconstr(param)), N)
  const eqParts = flattenApp(ifPattern.condition);
  const eqBuiltin = getBuiltinName(eqParts[0]);
  if (eqBuiltin !== 'equalsInteger') return null;
  
  // One arg should be the fstPair(unconstr(x)) pattern, other should be constant
  let constIndex: bigint | null = null;
  
  for (let i = 1; i < eqParts.length; i++) {
    const constVal = extractIntConstant(eqParts[i]);
    if (constVal !== null) {
      constIndex = constVal;
    }
  }
  
  if (constIndex === null) return null;
  
  // Check that else branch is fail/error
  if (ifPattern.elseBranch.tag !== 'error') return null;
  
  return Number(constIndex);
}

interface IfPattern {
  condition: UplcTerm;
  thenBranch: UplcTerm;
  elseBranch: UplcTerm;
}

/**
 * Match ifThenElse application
 */
function matchIfThenElse(term: UplcTerm): IfPattern | null {
  const parts = flattenApp(term);
  if (parts.length < 4) return null;
  
  const builtin = getBuiltinName(parts[0]);
  if (builtin !== 'ifThenElse') return null;
  
  return {
    condition: parts[1],
    thenBranch: parts[2],
    elseBranch: parts[3],
  };
}

/**
 * Flatten nested applications into a list
 */
function flattenApp(term: UplcTerm): UplcTerm[] {
  const parts: UplcTerm[] = [];
  let current = term;
  
  while (current.tag === 'app') {
    parts.unshift(current.arg);
    current = current.func;
  }
  
  // Handle force at head
  current = unwrapForces(current);
  parts.unshift(current);
  
  return parts;
}

/**
 * Unwrap force/delay wrappers
 */
function unwrapForces(term: UplcTerm): UplcTerm {
  while (term.tag === 'force' || term.tag === 'delay') {
    term = term.tag === 'force' ? term.term : term.term;
  }
  return term;
}

/**
 * Get builtin name from a term (handling force wrappers)
 */
function getBuiltinName(term: UplcTerm): string | null {
  term = unwrapForces(term);
  return term.tag === 'builtin' ? term.name : null;
}

/**
 * Extract integer constant from a term
 */
function extractIntConstant(term: UplcTerm): bigint | null {
  if (term.tag === 'con' && term.value?.tag === 'integer') {
    return term.value.value;
  }
  return null;
}

/**
 * Convert detected pattern to a semantic name
 */
function patternToName(pattern: DetectedPattern): string {
  switch (pattern.type) {
    case 'identity': return 'id';
    case 'apply': return 'apply';
    case 'compose': return 'compose';
    case 'unwrap_constr': return 'unwrap_constr';
    case 'expect_constr_0': return 'expect_constr_0';
    case 'expect_constr_n': 
      const idx = pattern.metadata?.index as number;
      return `expect_constr_${idx}`;
    case 'unwrap_data':
      const builtin = pattern.metadata?.builtin as string;
      return BUILTIN_HELPERS[builtin] || builtin;
    default:
      return 'helper';
  }
}

/**
 * Analyze all let-bound lambdas in a term and extract helpers
 */
export function extractHelpers(term: UplcTerm): Map<string, ExtractedHelper> {
  const helpers = new Map<string, ExtractedHelper>();
  
  // Walk the AST looking for let-bound lambdas
  // In UPLC, "let x = expr in body" is represented as ((lam x body) expr)
  walkForHelpers(term, helpers);
  
  return helpers;
}

/**
 * Walk AST to find helper patterns
 */
function walkForHelpers(term: UplcTerm, helpers: Map<string, ExtractedHelper>): void {
  switch (term.tag) {
    case 'lam':
      walkForHelpers(term.body, helpers);
      break;
      
    case 'app':
      // Check for let pattern: ((lam x body) value)
      if (term.func.tag === 'lam') {
        const boundName = term.func.param;
        const boundValue = term.arg;
        
        // Analyze the bound value
        const helper = analyzeHelper(boundValue);
        if (helper) {
          helper.originalName = boundName;
          helpers.set(boundName, helper);
        }
        
        // Continue walking
        walkForHelpers(term.func.body, helpers);
        walkForHelpers(term.arg, helpers);
      } else {
        walkForHelpers(term.func, helpers);
        walkForHelpers(term.arg, helpers);
      }
      break;
      
    case 'force':
    case 'delay':
      walkForHelpers(term.term, helpers);
      break;
      
    case 'case':
      if (term.scrutinee) walkForHelpers(term.scrutinee, helpers);
      if (term.branches) {
        for (const branch of term.branches) {
          walkForHelpers(branch, helpers);
        }
      }
      break;
  }
}

/**
 * Detect transaction field access pattern
 * 
 * Pattern: headList(tailList^n(sndPair(unConstrData(tx))))
 * Returns field index and name if matched
 */
export function detectTxFieldAccess(term: UplcTerm, txParam: string): { index: number; name: string } | null {
  // Count tail depth
  let tailCount = 0;
  let current = term;
  
  // Unwrap headList at the top
  const headParts = flattenApp(current);
  if (getBuiltinName(headParts[0]) !== 'headList' || headParts.length < 2) {
    return null;
  }
  current = headParts[1];
  
  // Count tailList applications
  while (true) {
    const parts = flattenApp(current);
    const builtin = getBuiltinName(parts[0]);
    
    if (builtin === 'tailList' && parts.length >= 2) {
      tailCount++;
      current = parts[1];
    } else if (builtin === 'sndPair' && parts.length >= 2) {
      // Check if it's sndPair(unConstrData(tx))
      const innerParts = flattenApp(parts[1]);
      if (getBuiltinName(innerParts[0]) === 'unConstrData' && innerParts.length >= 2) {
        if (innerParts[1].tag === 'var' && innerParts[1].name === txParam) {
          const fieldName = TX_FIELD_MAP[tailCount];
          if (fieldName) {
            return { index: tailCount, name: fieldName };
          }
        }
      }
      return null;
    } else {
      return null;
    }
  }
}
