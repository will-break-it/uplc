/**
 * AST Traversal Helpers
 */
import type { UplcTerm } from '@uplc/parser';

/**
 * Visitor function type
 */
export type Visitor = (term: UplcTerm, parent?: UplcTerm) => void;

/**
 * Traverse the AST depth-first, calling visitor on each node
 */
export function traverse(term: UplcTerm, visitor: Visitor, parent?: UplcTerm): void {
  visitor(term, parent);
  
  switch (term.tag) {
    case 'lam':
      traverse(term.body, visitor, term);
      break;
    case 'app':
      traverse(term.func, visitor, term);
      traverse(term.arg, visitor, term);
      break;
    case 'force':
      traverse(term.term, visitor, term);
      break;
    case 'delay':
      traverse(term.term, visitor, term);
      break;
    // var, con, builtin, error are leaf nodes
  }
}

/**
 * Find all nodes matching a predicate
 */
export function findAll(term: UplcTerm, predicate: (t: UplcTerm) => boolean): UplcTerm[] {
  const results: UplcTerm[] = [];
  traverse(term, (t) => {
    if (predicate(t)) results.push(t);
  });
  return results;
}

/**
 * Find first node matching a predicate
 */
export function findFirst(term: UplcTerm, predicate: (t: UplcTerm) => boolean): UplcTerm | undefined {
  let result: UplcTerm | undefined;
  traverse(term, (t) => {
    if (!result && predicate(t)) result = t;
  });
  return result;
}

/**
 * Check if a term is an application of a specific builtin
 */
export function isBuiltinApp(term: UplcTerm, name: string): boolean {
  if (term.tag !== 'app') return false;
  return isBuiltinCall(term.func, name);
}

/**
 * Check if a term is a builtin (possibly under forces)
 */
export function isBuiltinCall(term: UplcTerm, name: string): boolean {
  // Direct builtin
  if (term.tag === 'builtin' && term.name === name) return true;
  
  // Force of builtin
  if (term.tag === 'force') return isBuiltinCall(term.term, name);
  
  // Application to builtin (partially applied)
  if (term.tag === 'app') return isBuiltinCall(term.func, name);
  
  return false;
}

/**
 * Get the builtin name from a term that might be wrapped in force/app
 */
export function getBuiltinName(term: UplcTerm): string | undefined {
  if (term.tag === 'builtin') return term.name;
  if (term.tag === 'force') return getBuiltinName(term.term);
  if (term.tag === 'app') return getBuiltinName(term.func);
  return undefined;
}

/**
 * Extract all arguments from nested applications
 * [[[f a] b] c] -> [f, a, b, c]
 */
export function flattenApp(term: UplcTerm): UplcTerm[] {
  if (term.tag !== 'app') return [term];
  return [...flattenApp(term.func), term.arg];
}

/**
 * Check if term references a specific variable (as a use, not a binding)
 */
export function referencesVar(term: UplcTerm, name: string): boolean {
  let found = false;
  
  function search(t: UplcTerm, boundNames: Set<string>): void {
    if (found) return;
    
    switch (t.tag) {
      case 'var':
        if (t.name === name && !boundNames.has(name)) {
          found = true;
        }
        break;
      case 'lam':
        // Add param to bound names for the body
        const newBound = new Set(boundNames);
        newBound.add(t.param);
        search(t.body, newBound);
        break;
      case 'app':
        search(t.func, boundNames);
        search(t.arg, boundNames);
        break;
      case 'force':
        search(t.term, boundNames);
        break;
      case 'delay':
        search(t.term, boundNames);
        break;
    }
  }
  
  search(term, new Set());
  return found;
}

/**
 * Count how many times a variable is referenced
 */
export function countVarRefs(term: UplcTerm, name: string): number {
  let count = 0;
  traverse(term, (t) => {
    if (t.tag === 'var' && t.name === name) count++;
  });
  return count;
}

/**
 * Extract an integer constant from a term
 */
export function extractIntConstant(term: UplcTerm): bigint | undefined {
  if (term.tag === 'con' && term.value.tag === 'integer') {
    return term.value.value;
  }
  return undefined;
}
