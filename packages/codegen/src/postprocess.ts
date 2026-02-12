/**
 * Post-processing transformations for generated code
 * 
 * These run after initial code generation to simplify and clean up output.
 */

/**
 * Simplify boolean expressions
 * - ifThenElse(cond, True, False) → cond
 * - ifThenElse(cond, False, True) → !cond
 * - if cond { True } else { False } → cond
 */
export function simplifyBooleans(code: string): string {
  // Pattern: if X { True } else { False } → X
  code = code.replace(
    /if\s+(.+?)\s*\{\s*True\s*\}\s*else\s*\{\s*False\s*\}/g,
    '$1'
  );
  
  // Pattern: if X { False } else { True } → !X
  code = code.replace(
    /if\s+(.+?)\s*\{\s*False\s*\}\s*else\s*\{\s*True\s*\}/g,
    '!($1)'
  );
  
  // Simplify double negation: !(!X) → X
  code = code.replace(/!\s*\(\s*!\s*\(([^)]+)\)\s*\)/g, '$1');
  
  // Simplify: !(X == Y) → X != Y
  code = code.replace(/!\s*\(\s*(.+?)\s*==\s*(.+?)\s*\)/g, '$1 != $2');
  
  return code;
}

/**
 * Simplify comparison chains
 * - lessThanInteger(a, b) already becomes a < b
 * - Chain: a < b && b < c (leave as is, it's already good)
 */
export function simplifyComparisons(code: string): string {
  // These are already handled in builtinCallToExpression
  return code;
}

/**
 * Simplify nested conditionals into && and ||
 * - if A { B } else { False } → A && B (when B is truthy-ish)
 * - if A { True } else { B } → A || B
 */
export function simplifyLogicalOps(code: string): string {
  let prev = '';
  let iterations = 0;
  
  // Iterate until no more changes (handles nested patterns)
  while (code !== prev && iterations < 10) {
    prev = code;
    iterations++;
    
    // Pattern: if A { B } else { False } → (A && B)
    // where B is not a block with fail or complex expressions
    code = code.replace(
      /if\s+([a-z0-9_]+)\s*\{\s*([a-z0-9_]+)\s*\}\s*else\s*\{\s*False\s*\}/gi,
      '($1 && $2)'
    );
    
    // Pattern: if A { True } else { B } → (A || B)
    code = code.replace(
      /if\s+([a-z0-9_]+)\s*\{\s*True\s*\}\s*else\s*\{\s*([a-z0-9_]+)\s*\}/gi,
      '($1 || $2)'
    );
    
    // Pattern: if EXPR { VAR } else { False } for simple expressions
    code = code.replace(
      /if\s+([^{}]+?)\s*\{\s*([a-z0-9_]+)\s*\}\s*else\s*\{\s*False\s*\}/gi,
      '($1 && $2)'
    );
  }
  
  // Clean up excessive parentheses from && chains
  // ((a && b) && c) → (a && b && c)
  code = code.replace(/\(\(([^()]+)\s*&&\s*([^()]+)\)\s*&&\s*([^()]+)\)/g, '($1 && $2 && $3)');
  code = code.replace(/\(([^()]+)\s*&&\s*\(([^()]+)\s*&&\s*([^()]+)\)\)/g, '($1 && $2 && $3)');
  
  // Clean up double spaces
  code = code.replace(/  +/g, ' ');
  
  return code;
}

/**
 * Simplify pair/tuple access chains
 * - x.2nd.head() → x.fields[0] (when x is unConstrData result)
 * - fstPair(unConstrData(x)) → x.tag
 * - sndPair(unConstrData(x)) → x.fields
 */
export function simplifyPairAccess(code: string): string {
  // .1st on unConstrData → .tag
  code = code.replace(/\(([^)]+)\)\.1st/g, (_, inner) => {
    if (inner.includes('unConstrData') || inner.match(/^\w+$/)) {
      return `${inner.replace(/unConstrData\(([^)]+)\)/, '$1')}.tag`;
    }
    return `(${inner}).1st`;
  });
  
  // .2nd on unConstrData → .fields
  code = code.replace(/\(([^)]+)\)\.2nd/g, (_, inner) => {
    if (inner.includes('unConstrData') || inner.match(/^\w+$/)) {
      return `${inner.replace(/unConstrData\(([^)]+)\)/, '$1')}.fields`;
    }
    return `(${inner}).2nd`;
  });
  
  // Simplify x.fields.head() → x.fields[0]
  code = code.replace(/\.fields\.head\(\)/g, '.fields[0]');
  
  // Simplify x.fields.tail().head() → x.fields[1]
  code = code.replace(/\.fields\.tail\(\)\.head\(\)/g, '.fields[1]');
  
  return code;
}

/**
 * Simplify repeated tail() chains (already done but add fallback)
 * - x.tail().tail().tail().head() → list.at(x, 3)
 */
export function simplifyTailChains(code: string): string {
  // Count consecutive .tail() calls followed by .head()
  const tailChainPattern = /(\w+(?:\.\w+)*)((?:\.tail\(\))+)\.head\(\)/g;
  
  return code.replace(tailChainPattern, (match, base, tails) => {
    const count = (tails.match(/\.tail\(\)/g) || []).length;
    if (count >= 3) {
      return `list.at(${base}, ${count})`;
    }
    return match;
  });
}

/**
 * Extract and name constants
 * - Long hex strings → named constants
 * - Repeated values → single constant
 */
export function extractConstants(code: string): { code: string; constants: string[] } {
  const constants: string[] = [];
  const hexPattern = /#"([a-f0-9]{32,})"/gi;
  const seen = new Map<string, string>();
  let constIndex = 0;
  
  const newCode = code.replace(hexPattern, (match, hex) => {
    if (seen.has(hex)) {
      return seen.get(hex)!;
    }
    
    // Generate name based on length
    let name: string;
    if (hex.length === 56) {
      name = `SCRIPT_HASH_${constIndex}`;
    } else if (hex.length === 64) {
      name = `POLICY_ID_${constIndex}`;
    } else {
      name = `CONST_${constIndex}`;
    }
    
    seen.set(hex, name);
    constants.push(`const ${name} = #"${hex}"`);
    constIndex++;
    
    return name;
  });
  
  return { code: newCode, constants };
}

/**
 * Format arithmetic expressions nicely
 * - Add spaces around operators (only in arithmetic context)
 * - Skip module paths and identifiers
 */
export function formatArithmetic(code: string): string {
  // Only add spaces around operators when there are digits involved
  // This avoids messing with module paths like aiken/crypto/bls12_381
  code = code.replace(/(\d+)\s*([+\-*/%])\s*(\d+)/g, '$1 $2 $3');
  
  return code;
}

/**
 * Detect and simplify recursive patterns (Y-combinator)
 * This is complex - for now just mark them
 */
export function detectRecursion(code: string): string {
  // Pattern: fn(f) { fn(x) { f(f)(x) } }
  // This is a simple Y-combinator detection
  if (code.includes('(f)(f)') || code.includes('(self)(self)')) {
    code = '// Recursive function detected\n' + code;
  }
  
  return code;
}

/**
 * Fix malformed if expressions
 * - `if X)` → `X`  (broken partial application)
 * - `if if X { Y } else { if Z) }` → `if X { Y } else { Z }`
 */
export function fixMalformedIf(code: string): string {
  // Pattern: `if VAR)` - broken partial ifThenElse, replace with just the var
  code = code.replace(/if\s+([a-z0-9_]+)\)/gi, '$1');
  
  // Pattern: `{ if VAR) }` - inside braces
  code = code.replace(/\{\s*if\s+([a-z0-9_]+)\)\s*\}/gi, '{ $1 }');
  
  return code;
}

/**
 * Remove duplicate let bindings
 * Keeps first definition, removes subsequent identical definitions
 */
export function deduplicateBindings(code: string): string {
  const seen = new Map<string, string>(); // name -> first definition
  const lines = code.split('\n');
  const result: string[] = [];
  
  for (const line of lines) {
    // Match let binding: `let name = ...`
    const match = line.match(/^(\s*)let\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
    
    if (match) {
      const [, indent, name, value] = match;
      const existingValue = seen.get(name);
      
      if (existingValue === undefined) {
        // First time seeing this name - keep it
        seen.set(name, value);
        result.push(line);
      } else if (existingValue === value) {
        // Exact duplicate - skip
        continue;
      } else {
        // Same name, different value - keep (might be intentional shadowing)
        result.push(line);
      }
    } else {
      result.push(line);
    }
  }
  
  return result.join('\n');
}

/**
 * Run all post-processing transformations
 */
export function postProcess(code: string): string {
  code = deduplicateBindings(code);
  code = simplifyBooleans(code);
  code = simplifyLogicalOps(code);
  code = simplifyPairAccess(code);
  code = simplifyTailChains(code);
  code = formatArithmetic(code);
  code = detectRecursion(code);
  code = fixMalformedIf(code);
  
  return code;
}
