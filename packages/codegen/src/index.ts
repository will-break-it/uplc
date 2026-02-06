/**
 * @uplc/codegen - Generate Aiken-like code from UPLC analysis
 * 
 * Takes ContractStructure from @uplc/patterns and generates
 * readable Aiken-style pseudocode.
 */

import type { ContractStructure } from '@uplc/patterns';
import { generateValidator } from './generator.js';
import { formatCode } from './formatter.js';

// Re-export types
export type { GeneratorOptions, GeneratedCode } from './types.js';

// Re-export utilities
export { generateValidator } from './generator.js';
export { formatCode } from './formatter.js';

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
  return formatCode(generated);
}
