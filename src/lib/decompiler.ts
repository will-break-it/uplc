/**
 * Decompiler - UPLC → Aiken-style code
 * 
 * Uses the deterministic decompiler packages to generate
 * readable Aiken-style pseudocode from UPLC bytecode.
 */

import { parseUplc } from '@uplc/parser';
import { analyzeContract } from '@uplc/patterns';
import { generate } from '@uplc/codegen';

export interface DecompilerResult {
  aikenCode: string;
  scriptPurpose: string;
  params: string[];
  redeemerVariants: number;
  validationChecks: number;
  error?: string;
}

/**
 * Decompile UPLC text to Aiken-style pseudocode
 */
export function decompileUplc(uplcText: string): DecompilerResult {
  try {
    // Parse UPLC text to AST
    const ast = parseUplc(uplcText);
    
    // Analyze contract structure
    const structure = analyzeContract(ast);
    
    // Generate Aiken-style code
    const aikenCode = generate(structure);
    
    return {
      aikenCode,
      scriptPurpose: structure.type,
      params: structure.params,
      redeemerVariants: structure.redeemer.variants.length,
      validationChecks: structure.checks.length
    };
  } catch (error: any) {
    return {
      aikenCode: `// Decompilation failed: ${error.message}`,
      scriptPurpose: 'unknown',
      params: [],
      redeemerVariants: 0,
      validationChecks: 0,
      error: error.message
    };
  }
}
