/**
 * Redeemer Pattern Detection
 * 
 * Detects redeemer variants by looking for constructor matching patterns:
 * 
 * 1. Classic ifThenElse pattern:
 *    (force (builtin ifThenElse)
 *      [(builtin equalsInteger) (fstPair (unConstrData redeemer)) (con integer N)]
 *      BRANCH_N
 *      ELSE)
 * 
 * 2. Plutus V3 case/constr pattern:
 *    (case (unConstrData redeemer)
 *      branch_0
 *      branch_1
 *      ...)
 * 
 * 3. chooseData pattern (checking data type):
 *    (force (force (force (force (force (builtin chooseData)) data) 
 *      constr_branch) map_branch) list_branch) int_branch) bytes_branch)
 */
import type { UplcTerm } from '@uplc/parser';
import type { RedeemerInfo, RedeemerVariant, FieldInfo } from './types.js';
import { 
  flattenApp, 
  getBuiltinName, 
  referencesVar, 
  findAll,
  extractIntConstant 
} from './traversal.js';

/**
 * Analyze redeemer patterns in a validator body
 */
export function analyzeRedeemer(body: UplcTerm, redeemerParam: string | undefined): RedeemerInfo {
  if (!redeemerParam) {
    return { variants: [], matchPattern: 'unknown' };
  }
  
  // Try V3 case pattern first (most reliable)
  const caseVariants = findCasePatternVariants(body, redeemerParam);
  if (caseVariants.length > 0) {
    return {
      variants: caseVariants,
      matchPattern: 'constructor'
    };
  }
  
  // Try ifThenElse pattern
  const ifVariants = findIfThenElseVariants(body, redeemerParam);
  if (ifVariants.length > 0) {
    return {
      variants: ifVariants,
      matchPattern: 'constructor'
    };
  }
  
  // Try chooseData pattern
  const chooseVariants = findChooseDataVariants(body, redeemerParam);
  if (chooseVariants.length > 0) {
    return {
      variants: chooseVariants,
      matchPattern: 'constructor'
    };
  }
  
  // Check if redeemer is unpacked at all (single variant)
  if (hasUnConstrData(body, redeemerParam)) {
    // Single variant - redeemer is used but no switch
    const fields = extractFieldAccessesFromBody(body, redeemerParam);
    return {
      variants: [{
        index: 0,
        name: 'action',
        fields,
        body
      }],
      matchPattern: 'constructor'
    };
  }
  
  return { variants: [], matchPattern: 'unknown' };
}

/**
 * Find variants using Plutus V3 case pattern
 * Pattern: (case scrutinee branch0 branch1 ...)
 */
function findCasePatternVariants(body: UplcTerm, redeemerParam: string): RedeemerVariant[] {
  const variants: RedeemerVariant[] = [];
  
  // Find all case expressions
  const cases = findAll(body, t => t.tag === 'case');
  
  for (const caseExpr of cases) {
    if (caseExpr.tag !== 'case') continue;
    
    // Check if scrutinee involves the redeemer
    if (!scrutineeReferencesRedeemer(caseExpr.scrutinee, redeemerParam)) {
      continue;
    }
    
    // Each branch is a variant
    for (let i = 0; i < caseExpr.branches.length; i++) {
      const branch = caseExpr.branches[i];
      const fields = extractFieldAccessesFromBranch(branch, redeemerParam);
      
      variants.push({
        index: i,
        name: `variant_${i}`,
        fields,
        body: branch
      });
    }
  }
  
  return variants;
}

/**
 * Check if a case scrutinee references the redeemer
 */
function scrutineeReferencesRedeemer(scrutinee: UplcTerm, redeemerParam: string): boolean {
  // Direct reference
  if (referencesVar(scrutinee, redeemerParam)) {
    return true;
  }
  
  // unConstrData(redeemer) pattern
  if (scrutinee.tag === 'app') {
    const parts = flattenApp(scrutinee);
    const builtin = getBuiltinName(parts[0]);
    if (builtin === 'unConstrData' && parts.length >= 2) {
      return referencesVar(parts[1], redeemerParam);
    }
  }
  
  // constr pattern wrapping redeemer access
  if (scrutinee.tag === 'constr') {
    return scrutinee.args?.some(arg => referencesVar(arg, redeemerParam)) || false;
  }
  
  return false;
}

/**
 * Find variants using ifThenElse pattern
 */
function findIfThenElseVariants(body: UplcTerm, redeemerParam: string): RedeemerVariant[] {
  const variants: RedeemerVariant[] = [];
  const seen = new Set<number>();
  
  findIfThenElseRecursive(body, redeemerParam, variants, seen);
  
  // Sort by index
  variants.sort((a, b) => a.index - b.index);
  
  return variants;
}

/**
 * Recursively find ifThenElse branches that match on redeemer
 */
function findIfThenElseRecursive(
  term: UplcTerm, 
  redeemerParam: string, 
  variants: RedeemerVariant[],
  seen: Set<number>
): void {
  // Match ifThenElse pattern
  const ifPattern = matchIfThenElse(term);
  
  if (ifPattern) {
    // Check if condition checks redeemer constructor index
    const indexCheck = matchConstructorIndexCheck(ifPattern.condition, redeemerParam);
    
    if (indexCheck !== undefined && !seen.has(indexCheck)) {
      seen.add(indexCheck);
      
      const fields = extractFieldAccessesFromBranch(ifPattern.thenBranch, redeemerParam);
      
      variants.push({
        index: indexCheck,
        name: `variant_${indexCheck}`,
        fields,
        body: ifPattern.thenBranch
      });
    }
    
    // Recurse into both branches
    findIfThenElseRecursive(ifPattern.elseBranch, redeemerParam, variants, seen);
    findIfThenElseRecursive(ifPattern.thenBranch, redeemerParam, variants, seen);
    return;
  }
  
  // Recurse through AST
  switch (term.tag) {
    case 'lam':
      findIfThenElseRecursive(term.body, redeemerParam, variants, seen);
      break;
    case 'app':
      findIfThenElseRecursive(term.func, redeemerParam, variants, seen);
      findIfThenElseRecursive(term.arg, redeemerParam, variants, seen);
      break;
    case 'force':
      findIfThenElseRecursive(term.term, redeemerParam, variants, seen);
      break;
    case 'delay':
      findIfThenElseRecursive(term.term, redeemerParam, variants, seen);
      break;
    case 'case':
      findIfThenElseRecursive(term.scrutinee, redeemerParam, variants, seen);
      term.branches.forEach(b => findIfThenElseRecursive(b, redeemerParam, variants, seen));
      break;
    case 'constr':
      term.args?.forEach(a => findIfThenElseRecursive(a, redeemerParam, variants, seen));
      break;
  }
}

/**
 * Find variants using chooseData pattern
 */
function findChooseDataVariants(body: UplcTerm, redeemerParam: string): RedeemerVariant[] {
  const variants: RedeemerVariant[] = [];
  
  // Find chooseData applications
  const chooseDataApps = findAll(body, t => {
    if (t.tag !== 'app') return false;
    const parts = flattenApp(t);
    const builtin = getBuiltinName(parts[0]);
    return builtin === 'chooseData';
  });
  
  for (const app of chooseDataApps) {
    if (app.tag !== 'app') continue;
    
    const parts = flattenApp(app);
    
    // chooseData takes: data, constr_branch, map_branch, list_branch, int_branch, bytes_branch
    // Check if it's applied to the redeemer
    if (parts.length >= 2 && referencesVar(parts[1], redeemerParam)) {
      // Extract branches (positions 2-6)
      const branchNames = ['constr', 'map', 'list', 'int', 'bytes'];
      for (let i = 0; i < 5 && i + 2 < parts.length; i++) {
        variants.push({
          index: i,
          name: branchNames[i],
          fields: [],
          body: parts[i + 2]
        });
      }
    }
  }
  
  return variants;
}

interface IfThenElsePattern {
  condition: UplcTerm;
  thenBranch: UplcTerm;
  elseBranch: UplcTerm;
}

/**
 * Match an ifThenElse application pattern
 */
function matchIfThenElse(term: UplcTerm): IfThenElsePattern | undefined {
  // [[[force (builtin ifThenElse)] cond] then] else]
  const parts = flattenApp(term);
  
  if (parts.length < 4) return undefined;
  
  const builtinName = getBuiltinName(parts[0]);
  if (builtinName !== 'ifThenElse') return undefined;
  
  return {
    condition: parts[1],
    thenBranch: parts[2],
    elseBranch: parts[3]
  };
}

/**
 * Match constructor index check pattern
 * Pattern: [(builtin equalsInteger) (fstPair (unConstrData redeemer)) (con integer N)]
 * Also handles: [(builtin equalsInteger) (con integer N) (fstPair (unConstrData redeemer))]
 */
function matchConstructorIndexCheck(condition: UplcTerm, redeemerParam: string): number | undefined {
  const parts = flattenApp(condition);
  
  if (parts.length < 3) return undefined;
  
  const builtinName = getBuiltinName(parts[0]);
  if (builtinName !== 'equalsInteger') return undefined;
  
  // Check both orderings of arguments
  for (let i = 1; i < parts.length; i++) {
    const constValue = extractIntConstant(parts[i]);
    if (constValue !== undefined) {
      for (let j = 1; j < parts.length; j++) {
        if (i === j) continue;
        if (isConstructorIndexAccess(parts[j], redeemerParam)) {
          return Number(constValue);
        }
      }
    }
  }
  
  return undefined;
}

/**
 * Check if a term accesses the constructor index of a variable
 * Pattern: fstPair(unConstrData(var))
 * Also handles wrapped in unIData: unIData(fstPair(unConstrData(var)))
 */
function isConstructorIndexAccess(term: UplcTerm, varName: string): boolean {
  let current = term;
  
  // Unwrap unIData if present
  if (current.tag === 'app') {
    const parts = flattenApp(current);
    if (getBuiltinName(parts[0]) === 'unIData' && parts.length >= 2) {
      current = parts[1];
    }
  }
  
  const parts = flattenApp(current);
  const builtinName = getBuiltinName(parts[0]);
  
  if (builtinName !== 'fstPair') return false;
  if (parts.length < 2) return false;
  
  // Check argument is unConstrData applied to our variable
  const innerParts = flattenApp(parts[1]);
  const innerBuiltin = getBuiltinName(innerParts[0]);
  if (innerBuiltin !== 'unConstrData') return false;
  if (innerParts.length < 2) return false;
  
  return referencesVar(innerParts[1], varName);
}

/**
 * Check if body has unConstrData on the redeemer
 */
function hasUnConstrData(body: UplcTerm, redeemerParam: string): boolean {
  const apps = findAll(body, t => {
    if (t.tag !== 'app') return false;
    const parts = flattenApp(t);
    const builtin = getBuiltinName(parts[0]);
    if (builtin !== 'unConstrData') return false;
    if (parts.length < 2) return false;
    return referencesVar(parts[1], redeemerParam);
  });
  
  return apps.length > 0;
}

/**
 * Extract field accesses from a branch body
 */
function extractFieldAccessesFromBranch(branch: UplcTerm, redeemerParam: string): FieldInfo[] {
  return extractFieldAccessesFromBody(branch, redeemerParam);
}

/**
 * Extract all field accesses from a body
 */
function extractFieldAccessesFromBody(body: UplcTerm, redeemerParam: string): FieldInfo[] {
  const fields: FieldInfo[] = [];
  const seenIndices = new Set<number>();
  
  // Find all headList applications
  const headListApps = findAll(body, t => {
    if (t.tag !== 'app') return false;
    const parts = flattenApp(t);
    return getBuiltinName(parts[0]) === 'headList';
  });
  
  for (const app of headListApps) {
    if (app.tag !== 'app') continue;
    
    const parts = flattenApp(app);
    if (parts.length < 2) continue;
    
    const fieldIndex = measureTailDepth(parts[1], redeemerParam);
    if (fieldIndex !== undefined && !seenIndices.has(fieldIndex)) {
      seenIndices.add(fieldIndex);
      fields.push({
        index: fieldIndex,
        accessPattern: `field_${fieldIndex}`,
        inferredType: inferFieldType(body, app)
      });
    }
  }
  
  // Sort by index
  fields.sort((a, b) => a.index - b.index);
  
  return fields;
}

/**
 * Count tailList depth to determine field index
 */
function measureTailDepth(term: UplcTerm, redeemerParam: string): number | undefined {
  let depth = 0;
  let current = term;
  
  while (true) {
    const parts = flattenApp(current);
    const builtinName = getBuiltinName(parts[0]);
    
    if (builtinName === 'tailList') {
      depth++;
      if (parts.length < 2) return undefined;
      current = parts[1];
    } else if (builtinName === 'sndPair') {
      if (parts.length < 2) return undefined;
      const innerParts = flattenApp(parts[1]);
      const innerBuiltin = getBuiltinName(innerParts[0]);
      if (innerBuiltin === 'unConstrData' && innerParts.length >= 2) {
        if (referencesVar(innerParts[1], redeemerParam)) {
          return depth;
        }
      }
      return undefined;
    } else if (referencesVar(current, redeemerParam)) {
      // Direct reference to a list derived from redeemer
      return depth;
    } else {
      return undefined;
    }
  }
}

/**
 * Infer field type from how it's used
 */
function inferFieldType(body: UplcTerm, fieldExpr: UplcTerm): string {
  // Find parent applications that consume this field
  // Look for type-revealing builtins
  
  // For now, return unknown - this can be enhanced
  return 'unknown';
}
