/**
 * @uplc/codegen - Generate Aiken code from UPLC analysis
 * 
 * Takes ContractStructure from @uplc/patterns and generates
 * compilable Aiken code with proper imports.
 */

import type { ContractStructure } from '@uplc/patterns';
import { generateValidator } from './generator.js';
import { formatCode } from './formatter.js';
import { postProcess, extractConstants } from './postprocess.js';

// Re-export types
export type { GeneratorOptions, GeneratedCode } from './types.js';

// Re-export utilities
export { generateValidator, generateFragmented } from './generator.js';
export type { FragmentedOutput } from './generator.js';
export { formatCode } from './formatter.js';
export { BUILTIN_MAP, getRequiredImports, builtinToAiken } from './stdlib.js';
export { postProcess, extractConstants } from './postprocess.js';
export { BindingEnvironment } from './bindings.js';
export type { ResolvedBinding, BindingPattern } from './bindings.js';
export { extractFragments, formatFragmentsForAI } from './fragments.js';
export type { CodeFragment, FragmentRole, FragmentedCode } from './fragments.js';
export { detectTxField, detectDataField, detectBooleanChain, detectConstrMatch, TX_FIELDS } from './patterns.js';
export type { DetectedPattern, PatternKind } from './patterns.js';
export { estimateCost, getCostWarnings, parseCostModelJSON, BUILTIN_CPU_COSTS, TX_BUDGET } from './costs.js';
export type { CostEstimate, AstStats, MachineCostParams } from './costs.js';
export { verifyCode, checkBalancedDelimiters, checkValidatorStructure, checkSyntaxIssues } from './verify.js';
export type { VerificationResult, UplcConstants, StructuralCheck } from './verify.js';
export { extractHelpers, detectTxFieldAccess, TX_FIELD_MAP } from './helpers.js';
export type { BuiltinMapping } from './stdlib.js';
export type { ExtractedHelper, HelperPattern } from './helpers.js';

/**
 * Generate Aiken-like code from a contract structure
 * 
 * @param structure - Analyzed contract structure from @uplc/patterns
 * @param options - Code generation options
 * @returns Formatted Aiken-style code
 */
export function generate(structure: ContractStructure, options?: Partial<import('./types.js').GeneratorOptions>): string {
  const generated = generateValidator(structure, options);
  let code = formatCode(generated);
  
  // Post-process: simplify tail chains, booleans, etc.
  code = simplifyTailChains(code);
  code = postProcess(code);
  
  // Extract constants from inline hex strings, but only if we don't already have scriptParams
  // (scriptParams are extracted at the top-level and are authoritative)
  if (!generated.scriptParams || generated.scriptParams.length === 0) {
    const { code: finalCode, constants } = extractConstants(code);

    // Insert constants after `use` imports (Aiken requires `use` before `const`)
    if (constants.length > 0) {
      const lines = finalCode.split('\n');
      let insertIdx = 0;
      // Find end of `use` block
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('use ')) {
          insertIdx = i + 1;
        } else if (lines[i].trim() === '' && insertIdx > 0) {
          insertIdx = i + 1; // skip blank line after use block
          break;
        } else if (insertIdx > 0) {
          break; // first non-use, non-blank line
        }
      }
      const before = lines.slice(0, insertIdx).join('\n');
      const after = lines.slice(insertIdx).join('\n');
      code = before + (before ? '\n' : '') + constants.join('\n') + '\n\n' + after;
    } else {
      code = finalCode;
    }
  }
  
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
