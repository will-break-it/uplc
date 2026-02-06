/**
 * UPLC AST → IR Converter
 */

import type { UplcTerm } from '@uplc/parser';
import type {
  IRExpression,
  IRStatement,
  IRType,
  IRFunction,
  IRModule,
  BinaryOp
} from './types.js';

interface ConversionContext {
  variables: Map<string, IRType>;
  functionDepth: number;
}

/**
 * Convert UPLC AST to IR Module
 */
export function uplcToIR(ast: UplcTerm): IRModule {
  const ctx: ConversionContext = {
    variables: new Map(),
    functionDepth: 0
  };

  // For now, convert to a single main function
  const statements = termToStatements(ast, ctx);

  return {
    types: [],
    functions: [{
      name: 'main',
      params: [],
      returnType: { kind: 'bool' },
      body: statements
    }],
    imports: []
  };
}

function termToStatements(term: UplcTerm, ctx: ConversionContext): IRStatement[] {
  const expr = termToExpression(term, ctx);
  return [{ kind: 'return', value: expr }];
}

function termToExpression(term: UplcTerm, ctx: ConversionContext): IRExpression {
  switch (term.tag) {
    case 'con':
      return constToExpression(term);

    case 'var':
      return {
        kind: 'variable',
        name: term.name,
        type: ctx.variables.get(term.name) || { kind: 'unknown' }
      };

    case 'lam': {
      const paramType: IRType = { kind: 'unknown' };
      const newCtx = { ...ctx };
      newCtx.variables.set(term.param, paramType);
      newCtx.functionDepth++;

      const body = termToStatements(term.body, newCtx);

      return {
        kind: 'lambda',
        params: [{ name: term.param, type: paramType }],
        body,
        type: {
          kind: 'function',
          params: [paramType],
          returns: { kind: 'unknown' }
        }
      };
    }

    case 'app':
      return appToExpression(term, ctx);

    case 'builtin':
      return {
        kind: 'variable',
        name: term.name,
        type: { kind: 'function', params: [], returns: { kind: 'unknown' } }
      };

    case 'force':
      return termToExpression(term.term, ctx);

    case 'delay':
      return termToExpression(term.term, ctx);

    case 'error':
      return {
        kind: 'literal',
        type: { kind: 'unit' },
        value: null
      };

    case 'case':
      return caseToExpression(term, ctx);

    case 'constr':
      return {
        kind: 'constructor',
        typeName: `Constr${term.index}`,
        args: (term.args || []).map(arg => termToExpression(arg, ctx)),
        type: { kind: 'custom', name: `Constr${term.index}` }
      };

    default:
      return {
        kind: 'literal',
        type: { kind: 'unknown' },
        value: null
      };
  }
}

function constToExpression(term: any): IRExpression {
  if (!term.value) {
    return {
      kind: 'literal',
      type: { kind: 'unit' },
      value: null
    };
  }

  switch (term.value.tag) {
    case 'integer':
      return {
        kind: 'literal',
        type: { kind: 'int' },
        value: term.value.value
      };

    case 'bool':
      return {
        kind: 'literal',
        type: { kind: 'bool' },
        value: term.value.value
      };

    case 'bytestring':
      return {
        kind: 'literal',
        type: { kind: 'bytes' },
        value: term.value.value
      };

    case 'string':
      return {
        kind: 'literal',
        type: { kind: 'string' },
        value: term.value.value
      };

    case 'unit':
      return {
        kind: 'literal',
        type: { kind: 'unit' },
        value: null
      };

    default:
      return {
        kind: 'literal',
        type: { kind: 'unknown' },
        value: term.value
      };
  }
}

function appToExpression(term: any, ctx: ConversionContext): IRExpression {
  // Check for binary operators
  const binaryOp = detectBinaryOp(term, ctx);
  if (binaryOp) {
    return binaryOp;
  }

  // Regular function call
  const func = termToExpression(term.func, ctx);
  const arg = termToExpression(term.arg, ctx);

  return {
    kind: 'call',
    func,
    args: [arg],
    type: { kind: 'unknown' }
  };
}

function detectBinaryOp(term: any, ctx: ConversionContext): IRExpression | null {
  // Flatten application to check for builtin patterns
  const parts: any[] = [];
  let current = term;

  while (current.tag === 'app') {
    parts.unshift(current.arg);
    current = current.func;
  }

  // Handle force wrappers
  while (current.tag === 'force') {
    current = current.term;
  }

  if (current.tag !== 'builtin') return null;

  const builtinName = current.name;
  const opMap: Record<string, BinaryOp> = {
    'addInteger': 'add',
    'subtractInteger': 'sub',
    'multiplyInteger': 'mul',
    'divideInteger': 'div',
    'modInteger': 'mod',
    'equalsInteger': 'eq',
    'lessThanInteger': 'lt',
    'lessThanEqualsInteger': 'le',
    'equalsByteString': 'eq',
    'appendByteString': 'concat',
    'appendString': 'concat'
  };

  const op = opMap[builtinName];
  if (!op || parts.length !== 2) return null;

  return {
    kind: 'binary',
    op,
    left: termToExpression(parts[0], ctx),
    right: termToExpression(parts[1], ctx),
    type: { kind: 'unknown' }
  };
}

function caseToExpression(term: any, ctx: ConversionContext): IRExpression {
  return {
    kind: 'when',
    scrutinee: termToExpression(term.scrutinee, ctx),
    branches: (term.branches || []).map((branch: any, index: number) => ({
      pattern: { kind: 'literal', value: index },
      body: termToStatements(branch, ctx)
    })),
    type: { kind: 'unknown' }
  };
}
