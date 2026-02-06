import type { UplcTerm } from '@uplc/parser';
import type { RedeemerInfo, RedeemerVariant, FieldInfo } from './types.js';

/**
 * Detect redeemer pattern matching in the contract body.
 * 
 * Looks for patterns like:
 * (force (builtin ifThenElse)
 *   [(builtin equalsInteger) (fstPair (unConstrData redeemer)) (con integer N)]
 *   BRANCH_N
 *   ELSE)
 */
export function detectRedeemerVariants(body: UplcTerm, redeemerParam: string): RedeemerInfo {
  const variants: RedeemerVariant[] = [];
  
  // Find constructor matching patterns
  findConstructorMatches(body, redeemerParam, variants);
  
  return {
    variants,
    matchPattern: variants.length > 0 ? 'constructor' : 'unknown',
  };
}

/**
 * Recursively find constructor matching patterns
 */
function findConstructorMatches(
  term: UplcTerm,
  redeemerParam: string,
  variants: RedeemerVariant[]
): void {
  // Look for: (force (builtin ifThenElse) COND THEN ELSE)
  if (term.tag === 'app') {
    const { condition, thenBranch, elseBranch } = parseIfThenElse(term);
    
    if (condition && thenBranch && elseBranch) {
      // Check if condition is constructor index match
      const constructorIndex = parseConstructorMatch(condition, redeemerParam);
      
      if (constructorIndex !== null) {
        // Found a variant!
        const fields = detectFieldAccess(thenBranch, redeemerParam);
        
        variants.push({
          index: constructorIndex,
          name: `Variant${constructorIndex}`,
          fields,
          body: thenBranch,
        });
        
        // Continue looking in else branch for more variants
        findConstructorMatches(elseBranch, redeemerParam, variants);
        return;
      }
    }
    
    // Recurse into both sides
    findConstructorMatches(term.func, redeemerParam, variants);
    findConstructorMatches(term.arg, redeemerParam, variants);
  } else if (term.tag === 'lam') {
    findConstructorMatches(term.body, redeemerParam, variants);
  } else if (term.tag === 'force' || term.tag === 'delay') {
    findConstructorMatches(term.term, redeemerParam, variants);
  }
}

/**
 * Parse an ifThenElse application pattern
 */
function parseIfThenElse(term: UplcTerm): {
  condition: UplcTerm | null;
  thenBranch: UplcTerm | null;
  elseBranch: UplcTerm | null;
} {
  // Pattern: [[[force (builtin ifThenElse)] cond] then] else
  if (term.tag !== 'app') return { condition: null, thenBranch: null, elseBranch: null };
  
  const elseBranch = term.arg;
  const inner1 = term.func;
  
  if (inner1.tag !== 'app') return { condition: null, thenBranch: null, elseBranch: null };
  
  const thenBranch = inner1.arg;
  const inner2 = inner1.func;
  
  if (inner2.tag !== 'app') return { condition: null, thenBranch: null, elseBranch: null };
  
  const condition = inner2.arg;
  const ifThenElse = inner2.func;
  
  // Check if it's (force (builtin ifThenElse))
  if (ifThenElse.tag === 'force' && 
      ifThenElse.term.tag === 'builtin' && 
      ifThenElse.term.name === 'ifThenElse') {
    return { condition, thenBranch, elseBranch };
  }
  
  return { condition: null, thenBranch: null, elseBranch: null };
}

/**
 * Check if a condition is matching constructor index
 * Pattern: [(builtin equalsInteger) (fstPair (unConstrData VAR)) (con integer N)]
 */
function parseConstructorMatch(cond: UplcTerm, redeemerParam: string): number | null {
  // Pattern: [[equalsInteger [fstPair [unConstrData var]]] const]
  if (cond.tag !== 'app') return null;
  
  const constVal = cond.arg;
  const inner = cond.func;
  
  if (inner.tag !== 'app') return null;
  
  const fstPairApp = inner.arg;
  const eqInt = inner.func;
  
  // Check for equalsInteger builtin
  if (!(eqInt.tag === 'builtin' && eqInt.name === 'equalsInteger') &&
      !(eqInt.tag === 'app' && eqInt.func.tag === 'builtin' && eqInt.func.name === 'equalsInteger')) {
    return null;
  }
  
  // Check for fstPair(unConstrData(redeemer))
  if (!checkFstPairUnConstrData(fstPairApp, redeemerParam)) {
    return null;
  }
  
  // Extract constant integer
  if (constVal.tag === 'con' && constVal.value.tag === 'integer') {
    return Number(constVal.value.value);
  }
  
  return null;
}

/**
 * Check for pattern: (fstPair (unConstrData VAR))
 */
function checkFstPairUnConstrData(term: UplcTerm, varName: string): boolean {
  // [fstPair [unConstrData var]]
  if (term.tag !== 'app') return false;
  
  const unConstrApp = term.arg;
  const fstPair = term.func;
  
  // Check fstPair - might be forced
  const isFstPair = 
    (fstPair.tag === 'builtin' && fstPair.name === 'fstPair') ||
    (fstPair.tag === 'force' && fstPair.term.tag === 'builtin' && fstPair.term.name === 'fstPair');
  
  if (!isFstPair) return false;
  
  // Check unConstrData
  if (unConstrApp.tag !== 'app') return false;
  
  const varTerm = unConstrApp.arg;
  const unConstr = unConstrApp.func;
  
  const isUnConstrData = 
    (unConstr.tag === 'builtin' && unConstr.name === 'unConstrData');
  
  if (!isUnConstrData) return false;
  
  // Check if it's our variable
  return varTerm.tag === 'var' && varTerm.name === varName;
}

/**
 * Detect field access patterns in a branch body
 * Pattern: headList(tailList(...(sndPair(unConstrData(VAR)))))
 */
function detectFieldAccess(body: UplcTerm, redeemerParam: string): FieldInfo[] {
  const fields: FieldInfo[] = [];
  findFieldAccesses(body, redeemerParam, fields);
  return fields;
}

function findFieldAccesses(
  term: UplcTerm,
  redeemerParam: string,
  fields: FieldInfo[]
): void {
  // Look for headList applications
  if (term.tag === 'app') {
    const fieldInfo = parseFieldAccess(term, redeemerParam);
    if (fieldInfo) {
      // Avoid duplicates
      if (!fields.some(f => f.index === fieldInfo.index)) {
        fields.push(fieldInfo);
      }
    }
    
    // Recurse
    findFieldAccesses(term.func, redeemerParam, fields);
    findFieldAccesses(term.arg, redeemerParam, fields);
  } else if (term.tag === 'lam') {
    findFieldAccesses(term.body, redeemerParam, fields);
  } else if (term.tag === 'force' || term.tag === 'delay') {
    findFieldAccesses(term.term, redeemerParam, fields);
  }
}

function parseFieldAccess(term: UplcTerm, varName: string): FieldInfo | null {
  // Pattern: [headList [tailList* [sndPair [unConstrData var]]]]
  if (term.tag !== 'app') return null;
  
  const isHeadList = 
    term.func.tag === 'builtin' && term.func.name === 'headList' ||
    term.func.tag === 'force' && term.func.term.tag === 'builtin' && term.func.term.name === 'headList';
  
  if (!isHeadList) return null;
  
  // Count tailList depth
  let depth = 0;
  let current = term.arg;
  
  while (current.tag === 'app') {
    const isTailList = 
      current.func.tag === 'builtin' && current.func.name === 'tailList' ||
      current.func.tag === 'force' && current.func.term.tag === 'builtin' && current.func.term.name === 'tailList';
    
    if (isTailList) {
      depth++;
      current = current.arg;
    } else {
      break;
    }
  }
  
  // Check for sndPair(unConstrData(var))
  if (current.tag === 'app') {
    const isSndPair = 
      current.func.tag === 'builtin' && current.func.name === 'sndPair' ||
      current.func.tag === 'force' && current.func.term.tag === 'builtin' && current.func.term.name === 'sndPair';
    
    if (isSndPair && current.arg.tag === 'app') {
      const unConstrApp = current.arg;
      const isUnConstr = 
        unConstrApp.func.tag === 'builtin' && unConstrApp.func.name === 'unConstrData';
      
      if (isUnConstr && unConstrApp.arg.tag === 'var' && unConstrApp.arg.name === varName) {
        return {
          index: depth,
          accessPath: depth === 0 ? 'field_0' : `field_${depth}`,
          inferredType: 'unknown',
        };
      }
    }
  }
  
  return null;
}
