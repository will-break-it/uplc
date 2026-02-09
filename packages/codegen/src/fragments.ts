/**
 * Fragment Extraction - Identify logical code units for structured output
 * 
 * Instead of one giant nested lambda, extract:
 * - Validation functions (comparisons, checks)
 * - Data extractors (unpacking structures)
 * - Arithmetic functions (calculations)
 * - Recursive operations (folds, maps)
 * - Helper combinators (boolean logic, composition)
 * 
 * This enables AI to process smaller, focused chunks with clear context.
 */

import type { UplcTerm } from '@uplc/parser';
import type { ResolvedBinding } from './bindings.js';

/**
 * A code fragment with metadata for AI processing
 */
export interface CodeFragment {
  id: string;                    // Unique identifier
  name: string;                  // Original binding name
  role: FragmentRole;            // Semantic role
  params: string[];              // Parameter names
  returnType: string;            // Inferred return type hint
  builtinsUsed: string[];        // Builtins for context
  complexity: number;            // Rough complexity score
  body: UplcTerm;                // The actual code
  usageCount: number;            // How often it's referenced
  suggestedName?: string;        // AI naming hint based on pattern
}

export type FragmentRole = 
  | 'validator'      // Returns Bool, does comparisons
  | 'extractor'      // Unpacks data structures  
  | 'calculator'     // Arithmetic operations
  | 'fold'           // Recursive list operations
  | 'combinator'     // Boolean/function composition
  | 'constructor'    // Builds data structures
  | 'helper';        // General utility

/**
 * Structured output for AI processing
 */
export interface FragmentedCode {
  fragments: CodeFragment[];
  mainBody: UplcTerm;
  entryParams: string[];
}

/**
 * Builtin categories for role detection
 */
const VALIDATION_BUILTINS = new Set([
  'equalsInteger', 'equalsByteString', 'equalsData', 'equalsString',
  'lessThanInteger', 'lessThanEqualsInteger',
  'lessThanByteString', 'lessThanEqualsByteString',
  'verifyEd25519Signature', 'verifyEcdsaSecp256k1Signature',
  'nullList', 'ifThenElse'
]);

const ARITHMETIC_BUILTINS = new Set([
  'addInteger', 'subtractInteger', 'multiplyInteger', 
  'divideInteger', 'quotientInteger', 'remainderInteger', 'modInteger'
]);

const EXTRACTOR_BUILTINS = new Set([
  'unConstrData', 'unIData', 'unBData', 'unListData', 'unMapData',
  'fstPair', 'sndPair', 'headList', 'tailList'
]);

const CONSTRUCTOR_BUILTINS = new Set([
  'constrData', 'iData', 'bData', 'listData', 'mapData',
  'mkCons', 'mkPairData', 'mkNilData', 'mkNilPairData'
]);

/**
 * Extract fragments from bindings
 */
export function extractFragments(
  bindings: ResolvedBinding[],
  mainBody: UplcTerm,
  entryParams: string[]
): FragmentedCode {
  const fragments: CodeFragment[] = [];
  const usageMap = countUsages(mainBody, bindings);
  
  for (const binding of bindings) {
    // Skip already-handled bindings (inline, simple rename)
    if (binding.category !== 'keep') continue;
    
    // Only consider lambda bindings
    if (binding.value.tag !== 'lam') continue;
    
    // Extract fragment info
    const fragment = analyzeFragment(binding, usageMap.get(binding.name) || 0);
    if (fragment) {
      fragments.push(fragment);
    }
  }
  
  // Sort fragments by role and complexity
  fragments.sort((a, b) => {
    const roleOrder: Record<FragmentRole, number> = {
      'fold': 0,
      'calculator': 1,
      'validator': 2,
      'extractor': 3,
      'combinator': 4,
      'constructor': 5,
      'helper': 6
    };
    return (roleOrder[a.role] - roleOrder[b.role]) || (b.complexity - a.complexity);
  });
  
  return { fragments, mainBody, entryParams };
}

/**
 * Analyze a binding to create a fragment
 */
function analyzeFragment(binding: ResolvedBinding, usageCount: number): CodeFragment | null {
  const { name, value } = binding;
  
  // Extract params and body
  const params: string[] = [];
  let body = value;
  while (body.tag === 'lam') {
    params.push(body.param);
    body = body.body;
  }
  
  // Get builtins used
  const builtins = getBuiltinsUsed(value);
  
  // Detect role
  const role = detectRole(builtins, params, body);
  
  // Calculate complexity
  const complexity = calculateComplexity(value);
  
  // Skip trivial fragments (single variable return, etc.)
  if (complexity < 3 && role === 'helper') {
    return null;
  }
  
  // Infer return type
  const returnType = inferReturnType(body, role);
  
  // Generate suggested name based on pattern
  const suggestedName = suggestName(role, builtins, params);
  
  return {
    id: `frag_${name}`,
    name,
    role,
    params,
    returnType,
    builtinsUsed: builtins,
    complexity,
    body: value,
    usageCount,
    suggestedName
  };
}

/**
 * Get all builtins used in a term
 */
function getBuiltinsUsed(term: UplcTerm): string[] {
  const builtins = new Set<string>();
  
  function walk(t: UplcTerm): void {
    if (!t) return;
    
    if (t.tag === 'builtin') {
      builtins.add(t.name);
    }
    
    if ('body' in t && t.body) walk(t.body as UplcTerm);
    if ('func' in t && t.func) walk(t.func as UplcTerm);
    if ('arg' in t && t.arg) walk(t.arg as UplcTerm);
    if ('term' in t && t.term) walk(t.term as UplcTerm);
    if ('branches' in t && t.branches) {
      for (const b of t.branches as UplcTerm[]) walk(b);
    }
    if ('scrutinee' in t && t.scrutinee) walk(t.scrutinee as UplcTerm);
    if ('args' in t && t.args) {
      for (const a of t.args as UplcTerm[]) walk(a);
    }
  }
  
  walk(term);
  return Array.from(builtins);
}

/**
 * Detect the role of a fragment based on its builtins
 */
function detectRole(builtins: string[], params: string[], body: UplcTerm): FragmentRole {
  const builtinSet = new Set(builtins);
  
  // Check for recursive pattern (Y combinator binding)
  // These are typically marked in binding analysis
  if (params.length >= 1 && containsSelfReference(body, params[0])) {
    return 'fold';
  }
  
  // Check for validation (comparison builtins)
  const hasValidation = builtins.some(b => VALIDATION_BUILTINS.has(b));
  const hasArithmetic = builtins.some(b => ARITHMETIC_BUILTINS.has(b));
  const hasExtractor = builtins.some(b => EXTRACTOR_BUILTINS.has(b));
  const hasConstructor = builtins.some(b => CONSTRUCTOR_BUILTINS.has(b));
  
  // Pure arithmetic
  if (hasArithmetic && !hasValidation) {
    return 'calculator';
  }
  
  // Validation with optional extraction
  if (hasValidation) {
    return 'validator';
  }
  
  // Pure extraction
  if (hasExtractor && !hasConstructor) {
    return 'extractor';
  }
  
  // Data construction
  if (hasConstructor) {
    return 'constructor';
  }
  
  // Check for boolean combinator patterns (no builtins, just composition)
  if (builtins.length === 0 && params.length === 2) {
    return 'combinator';
  }
  
  return 'helper';
}

/**
 * Check if a term contains a reference to a variable (for recursion detection)
 */
function containsSelfReference(term: UplcTerm, varName: string): boolean {
  if (!term) return false;
  
  if (term.tag === 'var' && term.name === varName) {
    return true;
  }
  
  if ('body' in term && term.body) {
    if (containsSelfReference(term.body as UplcTerm, varName)) return true;
  }
  if ('func' in term && term.func) {
    if (containsSelfReference(term.func as UplcTerm, varName)) return true;
  }
  if ('arg' in term && term.arg) {
    if (containsSelfReference(term.arg as UplcTerm, varName)) return true;
  }
  if ('term' in term && term.term) {
    if (containsSelfReference(term.term as UplcTerm, varName)) return true;
  }
  
  return false;
}

/**
 * Calculate complexity score for a fragment
 */
function calculateComplexity(term: UplcTerm): number {
  let score = 0;
  
  function walk(t: UplcTerm, depth: number): void {
    if (!t) return;
    
    score += 1;
    if (t.tag === 'app') score += 1;
    if (t.tag === 'builtin') score += 2;
    if (t.tag === 'lam') score += 1;
    
    if ('body' in t && t.body) walk(t.body as UplcTerm, depth + 1);
    if ('func' in t && t.func) walk(t.func as UplcTerm, depth);
    if ('arg' in t && t.arg) walk(t.arg as UplcTerm, depth);
    if ('term' in t && t.term) walk(t.term as UplcTerm, depth);
    if ('branches' in t && t.branches) {
      for (const b of t.branches as UplcTerm[]) walk(b, depth);
    }
  }
  
  walk(term, 0);
  return score;
}

/**
 * Infer return type based on role and body
 */
function inferReturnType(body: UplcTerm, role: FragmentRole): string {
  switch (role) {
    case 'validator':
      return 'Bool';
    case 'calculator':
      return 'Int';
    case 'extractor':
      return 'Data';
    case 'fold':
      return 'a'; // Generic
    case 'combinator':
      return 'Bool';
    case 'constructor':
      return 'Data';
    default:
      return 'Data';
  }
}

/**
 * Suggest a name based on the pattern
 */
function suggestName(role: FragmentRole, builtins: string[], params: string[]): string {
  const prefixes: Record<FragmentRole, string> = {
    'validator': 'check',
    'calculator': 'calculate',
    'extractor': 'extract',
    'fold': 'fold',
    'combinator': 'combine',
    'constructor': 'build',
    'helper': 'helper'
  };
  
  const prefix = prefixes[role];
  
  // Add suffix based on primary builtin
  if (builtins.includes('equalsByteString')) {
    return `${prefix}_bytes_equal`;
  }
  if (builtins.includes('equalsInteger')) {
    return `${prefix}_int_equal`;
  }
  if (builtins.includes('lessThanInteger')) {
    return `${prefix}_less_than`;
  }
  if (builtins.includes('verifyEd25519Signature')) {
    return `${prefix}_signature`;
  }
  if (builtins.includes('addInteger') || builtins.includes('subtractInteger')) {
    return `${prefix}_amount`;
  }
  if (builtins.includes('multiplyInteger') || builtins.includes('divideInteger')) {
    return `${prefix}_ratio`;
  }
  
  return `${prefix}_${params.length}`;
}

/**
 * Count how many times each binding is referenced in the main body
 */
function countUsages(mainBody: UplcTerm, bindings: ResolvedBinding[]): Map<string, number> {
  const counts = new Map<string, number>();
  const bindingNames = new Set(bindings.map(b => b.name));
  
  function walk(term: UplcTerm): void {
    if (!term) return;
    
    if (term.tag === 'var' && bindingNames.has(term.name)) {
      counts.set(term.name, (counts.get(term.name) || 0) + 1);
    }
    
    if ('body' in term && term.body) walk(term.body as UplcTerm);
    if ('func' in term && term.func) walk(term.func as UplcTerm);
    if ('arg' in term && term.arg) walk(term.arg as UplcTerm);
    if ('term' in term && term.term) walk(term.term as UplcTerm);
    if ('branches' in term && term.branches) {
      for (const b of term.branches as UplcTerm[]) walk(b);
    }
    if ('scrutinee' in term && term.scrutinee) walk(term.scrutinee as UplcTerm);
    if ('args' in term && term.args) {
      for (const a of term.args as UplcTerm[]) walk(a);
    }
  }
  
  walk(mainBody);
  return counts;
}

/**
 * Format fragments for AI consumption
 */
export function formatFragmentsForAI(fragmented: FragmentedCode): string {
  const sections: string[] = [];
  
  // Group by role
  const byRole = new Map<FragmentRole, CodeFragment[]>();
  for (const frag of fragmented.fragments) {
    if (!byRole.has(frag.role)) {
      byRole.set(frag.role, []);
    }
    byRole.get(frag.role)!.push(frag);
  }
  
  // Format each role group
  const roleOrder: FragmentRole[] = ['fold', 'calculator', 'validator', 'extractor', 'combinator', 'constructor', 'helper'];
  
  for (const role of roleOrder) {
    const frags = byRole.get(role);
    if (!frags || frags.length === 0) continue;
    
    sections.push(`\n// === ${role.toUpperCase()} FRAGMENTS ===`);
    
    for (const frag of frags) {
      sections.push(formatFragment(frag));
    }
  }
  
  return sections.join('\n');
}

/**
 * Format a single fragment for output
 */
function formatFragment(frag: CodeFragment): string {
  const header = `\n// Fragment: ${frag.id} (${frag.role})`;
  const hint = frag.suggestedName ? `// Suggested: ${frag.suggestedName}` : '';
  const builtins = `// Uses: ${frag.builtinsUsed.slice(0, 5).join(', ')}`;
  const signature = `fn ${frag.name}(${frag.params.join(', ')}) -> ${frag.returnType}`;
  
  return [header, hint, builtins, signature].filter(Boolean).join('\n');
}
