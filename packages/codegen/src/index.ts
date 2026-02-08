/**
 * @uplc/codegen - Generate Aiken code from UPLC analysis
 * 
 * Takes ContractStructure from @uplc/patterns and generates
 * compilable Aiken code with proper imports.
 */

import type { ContractStructure } from '@uplc/patterns';
import { generateValidator } from './generator.js';
import { formatCode } from './formatter.js';

// Re-export types
export type { GeneratorOptions, GeneratedCode } from './types.js';

// Re-export utilities
export { generateValidator } from './generator.js';
export { formatCode } from './formatter.js';
export { BUILTIN_MAP, getRequiredImports, builtinToAiken } from './stdlib.js';
export type { BuiltinMapping } from './stdlib.js';

/**
 * Generate Aiken-like code from a contract structure
 * 
 * @param structure - Analyzed contract structure from @uplc/patterns
 * @param options - Code generation options
 * @returns Formatted Aiken-style code
 * 
 * @example
 * ```typescript
 * import { parseUplc } from '@uplc/parser';
 * import { analyzeContract } from '@uplc/patterns';
 * import { generate } from '@uplc/codegen';
 * 
 * const ast = parseUplc(uplcSource);
 * const structure = analyzeContract(ast);
 * const code = generate(structure);
 * 
 * console.log(code);
 * // validator my_validator {
 * //   spend(datum: Option<Data>, redeemer: Action, ctx: ScriptContext) {
 * //     when redeemer is {
 * //       variant_0 -> ...
 * //       variant_1 -> ...
 * //     }
 * //   }
 * // }
 * ```
 */
export function generate(structure: ContractStructure, options?: Partial<import('./types.js').GeneratorOptions>): string {
  const generated = generateValidator(structure, options);
  let code = formatCode(generated);
  
  // Post-process: simplify repeated .tail() chains
  code = simplifyTailChains(code);
  
  return code;
}

/**
 * Simplify repeated .tail() chains into indexed access
 * e.g., x.tail().tail().tail().head() → list.at(x, 3)
 */
function simplifyTailChains(code: string): string {
  // Pattern for identifier.tail().tail()...head() - must be simple identifier
  code = code.replace(
    /\b([a-zA-Z_][a-zA-Z0-9_]*)((?:\.tail\(\)){3,})\.head\(\)/g,
    (match, base, tails) => {
      const count = (tails.match(/\.tail\(\)/g) || []).length;
      return `list.at(${base}, ${count})`;
    }
  );
  
  // Pattern for expr.2nd.tail().tail()...head() chains
  code = code.replace(
    /\b([a-zA-Z_][a-zA-Z0-9_]*)\.(1st|2nd)((?:\.tail\(\)){3,})\.head\(\)/g,
    (match, base, accessor, tails) => {
      const count = (tails.match(/\.tail\(\)/g) || []).length;
      return `list.at(${base}.${accessor}, ${count})`;
    }
  );
  
  return code;
}
