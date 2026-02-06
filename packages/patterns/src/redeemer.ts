/**
 * Redeemer Pattern Detection
 * 
 * Detects redeemer variants by looking for constructor matching patterns:
 * 
 * (force (builtin ifThenElse)
 *   [(builtin equalsInteger) (fstPair (unConstrData redeemer)) (con integer N)]
 *   BRANCH_N
 *   ELSE)
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
  
  // Look for ifThenElse patterns that check the redeemer
  const variants = findRedeemerBranches(body, redeemerParam);
  
  // Determine the match pattern
  let matchPattern: 'constructor' | 'integer' | 'unknown' = 'unknown';
  if (variants.length > 0) {
    matchPattern = 'constructor';  // We found constructor-based matching
  }
  
  return {
    variants,
    matchPattern
  };
}

/**
 * Find all redeemer variant branches
 */
function findRedeemerBranches(term: UplcTerm, redeemerParam: string): RedeemerVariant[] {
  const variants: RedeemerVariant[] = [];
  const seen = new Set<number>();
  
  findBranchesRecursive(term, redeemerParam, variants, seen);
  
  // Sort by index
  variants.sort((a, b) => a.index - b.index);
  
  return variants;
}

/**
 * Recursively find branches that match on the redeemer constructor
 */
function findBranchesRecursive(
  term: UplcTerm, 
  redeemerParam: string, 
  variants: RedeemerVariant[],
  seen: Set<number>
): void {
  // Look for: [[[force (builtin ifThenElse)] condition] thenBranch] elseBranch]
  const ifPattern = matchIfThenElse(term);
  
  if (ifPattern) {
    // Check if condition is checking the redeemer constructor index
    const indexCheck = matchConstructorIndexCheck(ifPattern.condition, redeemerParam);
    
    if (indexCheck !== undefined && !seen.has(indexCheck)) {
      seen.add(indexCheck);
      
      // Extract fields accessed in the then branch
      const fields = extractFieldAccesses(ifPattern.thenBranch, redeemerParam);
      
      variants.push({
        index: indexCheck,
        name: `variant_${indexCheck}`,
        fields,
        body: ifPattern.thenBranch
      });
    }
    
    // Recurse into else branch to find more variants
    findBranchesRecursive(ifPattern.elseBranch, redeemerParam, variants, seen);
    // Also check the then branch for nested conditionals
    findBranchesRecursive(ifPattern.thenBranch, redeemerParam, variants, seen);
  }
  
  // Also recurse through the AST to find nested patterns
  switch (term.tag) {
    case 'lam':
      findBranchesRecursive(term.body, redeemerParam, variants, seen);
      break;
    case 'app':
      // Don't recurse into the parts we already checked if it was an ifThenElse
      if (!ifPattern) {
        findBranchesRecursive(term.func, redeemerParam, variants, seen);
        findBranchesRecursive(term.arg, redeemerParam, variants, seen);
      }
      break;
    case 'force':
      findBranchesRecursive(term.term, redeemerParam, variants, seen);
      break;
    case 'delay':
      findBranchesRecursive(term.term, redeemerParam, variants, seen);
      break;
  }
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
 * Check if a condition is checking the constructor index of the redeemer
 * Pattern: [(builtin equalsInteger) (fstPair (unConstrData redeemer)) (con integer N)]
 * 
 * Returns the constructor index being checked, or undefined
 */
function matchConstructorIndexCheck(condition: UplcTerm, redeemerParam: string): number | undefined {
  const parts = flattenApp(condition);
  
  if (parts.length < 3) return undefined;
  
  const builtinName = getBuiltinName(parts[0]);
  if (builtinName !== 'equalsInteger') return undefined;
  
  // One of the args should be the fstPair(unConstrData(redeemer)) pattern
  // The other should be an integer constant
  
  for (let i = 1; i < parts.length; i++) {
    const constValue = extractIntConstant(parts[i]);
    if (constValue !== undefined) {
      // Check if another argument accesses the redeemer constructor index
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
 */
function isConstructorIndexAccess(term: UplcTerm, varName: string): boolean {
  const parts = flattenApp(term);
  
  // Looking for [[force (force (builtin fstPair))] [[(force (builtin unConstrData))] var]]
  const builtinName = getBuiltinName(parts[0]);
  if (builtinName !== 'fstPair') return false;
  if (parts.length < 2) return false;
  
  // Check the argument is unConstrData applied to our variable
  const innerParts = flattenApp(parts[1]);
  const innerBuiltin = getBuiltinName(innerParts[0]);
  if (innerBuiltin !== 'unConstrData') return false;
  if (innerParts.length < 2) return false;
  
  // Final argument should reference our variable
  return referencesVar(innerParts[1], varName);
}

/**
 * Extract field accesses from a term
 */
function extractFieldAccesses(term: UplcTerm, redeemerParam: string): FieldInfo[] {
  const fields: FieldInfo[] = [];
  const seenIndices = new Set<number>();
  
  // Find all headList applications
  const headListApps = findAll(term, t => {
    if (t.tag !== 'app') return false;
    return getBuiltinName(t.func) === 'headList';
  });
  
  for (const app of headListApps) {
    if (app.tag !== 'app') continue;
    
    const fieldIndex = measureTailDepth(app.arg, redeemerParam);
    if (fieldIndex !== undefined && !seenIndices.has(fieldIndex)) {
      seenIndices.add(fieldIndex);
      fields.push({
        index: fieldIndex,
        accessPattern: fieldIndex === 0 
          ? 'headList(sndPair(unConstrData(...)))' 
          : `headList(${'tailList('.repeat(fieldIndex)}sndPair(unConstrData(...))${')'.repeat(fieldIndex)})`,
        inferredType: 'unknown'  // TODO: could infer from how the field is used
      });
    }
  }
  
  // Sort by index
  fields.sort((a, b) => a.index - b.index);
  
  return fields;
}

/**
 * Count the depth of tailList wrapping to determine field index
 * 
 * sndPair(unConstrData(x)) -> 0
 * tailList(sndPair(unConstrData(x))) -> 1
 * tailList(tailList(sndPair(unConstrData(x)))) -> 2
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
      // Check if this is sndPair(unConstrData(redeemerParam))
      if (parts.length < 2) return undefined;
      const innerParts = flattenApp(parts[1]);
      const innerBuiltin = getBuiltinName(innerParts[0]);
      if (innerBuiltin === 'unConstrData' && innerParts.length >= 2) {
        if (referencesVar(innerParts[1], redeemerParam)) {
          return depth;
        }
      }
      return undefined;
    } else {
      return undefined;
    }
  }
}
