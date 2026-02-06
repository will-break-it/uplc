/**
 * @uplc/ir - Intermediate Representation
 *
 * Provides a simplified IR between UPLC AST and target code generation.
 */

export * from './types.js';
export { uplcToIR } from './converter.js';
export { optimize, generateOptimizationHints, type OptimizerOptions } from './optimizer.js';
