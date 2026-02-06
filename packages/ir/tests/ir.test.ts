import { describe, it, expect } from 'vitest';
import { uplcToIR } from '../src/converter.js';
import { optimizeIR } from '../src/optimizer.js';

describe('IR Converter', () => {
  it('should convert simple constant', () => {
    const uplc = { tag: 'Constant', value: { kind: 'int', value: 42 } };
    const ir = uplcToIR(uplc);
    expect(ir.kind).toBe('literal');
  });
});

describe('IR Optimizer', () => {
  it('should perform constant folding', () => {
    const ir = {
      kind: 'binop' as const,
      op: 'add' as const,
      left: { kind: 'literal' as const, value: 1, type: { kind: 'int' as const } },
      right: { kind: 'literal' as const, value: 2, type: { kind: 'int' as const } },
      type: { kind: 'int' as const },
    };
    const optimized = optimizeIR(ir);
    expect(optimized.kind).toBe('literal');
    if (optimized.kind === 'literal') {
      expect(optimized.value).toBe(3);
    }
  });
});
