/**
 * IR Optimizer - Apply optimizations to IR
 */

import type { IRModule, IRExpression, IRStatement, IRFunction, OptimizationHint } from './types.js';

export interface OptimizerOptions {
  constantFolding?: boolean;
  deadCodeElimination?: boolean;
  inlining?: boolean;
  tailCallOptimization?: boolean;
}

const DEFAULT_OPTIONS: OptimizerOptions = {
  constantFolding: true,
  deadCodeElimination: true,
  inlining: true,
  tailCallOptimization: false // Experimental
};

/**
 * Optimize an IR module
 */
export function optimize(module: IRModule, options?: OptimizerOptions): IRModule {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  let optimized = module;

  if (opts.constantFolding) {
    optimized = applyConstantFolding(optimized);
  }

  if (opts.deadCodeElimination) {
    optimized = eliminateDeadCode(optimized);
  }

  if (opts.inlining) {
    optimized = applyInlining(optimized);
  }

  return optimized;
}

/**
 * Constant folding - evaluate constant expressions at compile time
 */
function applyConstantFolding(module: IRModule): IRModule {
  return {
    ...module,
    functions: module.functions.map(func => ({
      ...func,
      body: func.body.map(stmt => foldStatement(stmt))
    }))
  };
}

function foldStatement(stmt: IRStatement): IRStatement {
  switch (stmt.kind) {
    case 'let':
      return {
        ...stmt,
        value: foldExpression(stmt.value)
      };

    case 'return':
      return {
        ...stmt,
        value: foldExpression(stmt.value)
      };

    case 'if':
      return {
        ...stmt,
        condition: foldExpression(stmt.condition),
        then: stmt.then.map(foldStatement),
        else: stmt.else?.map(foldStatement)
      };

    case 'expression':
      return {
        ...stmt,
        value: foldExpression(stmt.value)
      };

    default:
      return stmt;
  }
}

function foldExpression(expr: IRExpression): IRExpression {
  switch (expr.kind) {
    case 'binary': {
      const left = foldExpression(expr.left);
      const right = foldExpression(expr.right);

      // If both sides are literals, evaluate
      if (left.kind === 'literal' && right.kind === 'literal') {
        const result = evaluateBinaryOp(expr.op, left.value, right.value);
        if (result !== undefined) {
          return {
            kind: 'literal',
            type: expr.type,
            value: result
          };
        }
      }

      return { ...expr, left, right };
    }

    case 'unary': {
      const operand = foldExpression(expr.operand);

      if (operand.kind === 'literal') {
        const result = evaluateUnaryOp(expr.op, operand.value);
        if (result !== undefined) {
          return {
            kind: 'literal',
            type: expr.type,
            value: result
          };
        }
      }

      return { ...expr, operand };
    }

    case 'call':
      return {
        ...expr,
        func: foldExpression(expr.func),
        args: expr.args.map(foldExpression)
      };

    default:
      return expr;
  }
}

function evaluateBinaryOp(op: string, left: any, right: any): any {
  if (typeof left === 'bigint' && typeof right === 'bigint') {
    switch (op) {
      case 'add': return left + right;
      case 'sub': return left - right;
      case 'mul': return left * right;
      case 'div': return right !== 0n ? left / right : undefined;
      case 'mod': return right !== 0n ? left % right : undefined;
      case 'eq': return left === right;
      case 'lt': return left < right;
      case 'le': return left <= right;
      case 'gt': return left > right;
      case 'ge': return left >= right;
    }
  }

  if (typeof left === 'boolean' && typeof right === 'boolean') {
    switch (op) {
      case 'and': return left && right;
      case 'or': return left || right;
      case 'eq': return left === right;
    }
  }

  return undefined;
}

function evaluateUnaryOp(op: string, operand: any): any {
  switch (op) {
    case 'not': return typeof operand === 'boolean' ? !operand : undefined;
    case 'negate': return typeof operand === 'bigint' ? -operand : undefined;
  }
  return undefined;
}

/**
 * Dead code elimination - remove unreachable code
 */
function eliminateDeadCode(module: IRModule): IRModule {
  return {
    ...module,
    functions: module.functions.map(func => ({
      ...func,
      body: eliminateDeadStatements(func.body)
    }))
  };
}

function eliminateDeadStatements(statements: IRStatement[]): IRStatement[] {
  const result: IRStatement[] = [];

  for (const stmt of statements) {
    result.push(stmt);

    // Stop after return or fail
    if (stmt.kind === 'return' || stmt.kind === 'fail') {
      break;
    }
  }

  return result;
}

/**
 * Inlining - inline small functions
 */
function applyInlining(module: IRModule): IRModule {
  // Simple inlining: inline single-statement functions
  // More sophisticated inlining would require call graph analysis
  return module;
}

/**
 * Generate optimization hints for further processing
 */
export function generateOptimizationHints(module: IRModule): OptimizationHint[] {
  const hints: OptimizationHint[] = [];

  // Detect inline opportunities
  for (const func of module.functions) {
    if (func.body.length === 1 && func.body[0]?.kind === 'return') {
      hints.push({
        kind: 'inline',
        target: func.name,
        confidence: 0.9
      });
    }
  }

  return hints;
}
