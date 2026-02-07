import { describe, it, expect } from 'vitest';
import { uplcToIR } from '../src/converter.js';
import { optimize } from '../src/optimizer.js';

describe('IR Converter', () => {
  it('should convert simple constant', () => {
    const uplc = { tag: 'con', value: { tag: 'integer', value: 42 } };
    const module = uplcToIR(uplc);

    // Check module structure
    expect(module.functions).toHaveLength(1);
    expect(module.functions[0].name).toBe('main');
    expect(module.functions[0].body).toHaveLength(1);

    // Check the returned expression is a literal
    const returnStmt = module.functions[0].body[0];
    expect(returnStmt.kind).toBe('return');
    if (returnStmt.kind === 'return') {
      expect(returnStmt.value.kind).toBe('literal');
      if (returnStmt.value.kind === 'literal') {
        expect(returnStmt.value.value).toBe(42);
      }
    }
  });
});

describe('IR Optimizer', () => {
  it('should perform constant folding', () => {
    const module = {
      types: [],
      functions: [{
        name: 'test',
        params: [],
        returnType: { kind: 'int' as const },
        body: [{
          kind: 'return' as const,
          value: {
            kind: 'binary' as const,
            op: 'add' as const,
            left: { kind: 'literal' as const, value: 1n, type: { kind: 'int' as const } },
            right: { kind: 'literal' as const, value: 2n, type: { kind: 'int' as const } },
            type: { kind: 'int' as const },
          }
        }]
      }],
      imports: []
    };

    const optimized = optimize(module);
    const returnStmt = optimized.functions[0].body[0];

    expect(returnStmt.kind).toBe('return');
    if (returnStmt.kind === 'return') {
      expect(returnStmt.value.kind).toBe('literal');
      if (returnStmt.value.kind === 'literal') {
        expect(returnStmt.value.value).toBe(3n);
      }
    }
  });
});
