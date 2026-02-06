import { describe, it, expect } from 'vitest';
import { DecompilerCache } from '../src/index.js';

describe('DecompilerCache', () => {
  it('should create cache instance', () => {
    const cache = new DecompilerCache();
    expect(cache).toBeDefined();
  });

  it('should store and retrieve AST', async () => {
    const cache = new DecompilerCache();
    const scriptHash = 'test_hash';
    const ast = { tag: 'Constant', value: { kind: 'int', value: 42 } };

    await cache.setAST(scriptHash, ast);
    const retrieved = await cache.getAST(scriptHash);

    expect(retrieved).toEqual(ast);
  });
});
