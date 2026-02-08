import { describe, it, expect } from 'vitest';
import { generate } from '../src/index.js';
import type { ContractStructure } from '@uplc/patterns';

describe('@uplc/codegen', () => {
  describe('generate', () => {
    it('generates simple validator', () => {
      const structure: ContractStructure = {
        type: 'spend',
        params: ['datum', 'redeemer', 'own_ref', 'tx'],
        redeemer: {
          variants: [],
          matchPattern: 'unknown'
        },
        checks: [],
        rawBody: { kind: 'const', value: { kind: 'unit' } } as any
      };

      const code = generate(structure);
      
      expect(code).toContain('validator decompiled_validator');
      expect(code).toContain('spend(');
      expect(code).toContain('True');
    });

    it('generates multi-variant redeemer', () => {
      const structure: ContractStructure = {
        type: 'spend',
        params: ['datum', 'redeemer', 'own_ref', 'tx'],
        redeemer: {
          variants: [
            { index: 0, name: 'variant_0', fields: [], body: { kind: 'const', value: { kind: 'unit' } } as any },
            { index: 1, name: 'variant_1', fields: [], body: { kind: 'const', value: { kind: 'unit' } } as any },
            { index: 2, name: 'variant_2', fields: [], body: { kind: 'const', value: { kind: 'unit' } } as any }
          ],
          matchPattern: 'constructor'
        },
        checks: [],
        rawBody: { kind: 'const', value: { kind: 'unit' } } as any
      };

      const code = generate(structure);
      
      expect(code).toContain('type Action {');
      expect(code).toContain('Cancel');
      expect(code).toContain('Update');
      expect(code).toContain('Claim');
      expect(code).toContain('when redeemer is {');
    });

    it('generates minting policy', () => {
      const structure: ContractStructure = {
        type: 'mint',
        params: ['redeemer', 'policy_id', 'tx'],
        redeemer: {
          variants: [],
          matchPattern: 'unknown'
        },
        checks: [],
        rawBody: { kind: 'const', value: { kind: 'unit' } } as any
      };

      const code = generate(structure);
      
      expect(code).toContain('mint(');
      expect(code).not.toContain('spend(');
    });

    it('generates with validation checks', () => {
      const structure: ContractStructure = {
        type: 'spend',
        params: ['datum', 'redeemer', 'own_ref', 'tx'],
        redeemer: {
          variants: [],
          matchPattern: 'unknown'
        },
        checks: [
          {
            type: 'signature',
            builtin: 'verifyEd25519Signature',
            description: 'signature check',
            location: { kind: 'const', value: { kind: 'unit' } } as any
          }
        ],
        rawBody: { kind: 'const', value: { kind: 'unit' } } as any
      };

      const code = generate(structure);
      
      expect(code).toContain('list.has(tx.extra_signatories');
    });

    it('handles deeply nested lambdas without ??? output', () => {
      // Create a deeply nested lambda structure (600+ depth)
      // This tests the recursion depth limit fix
      let deepBody: any = { tag: 'con', value: { tag: 'bool', value: true } };
      
      for (let i = 0; i < 700; i++) {
        deepBody = {
          tag: 'lam',
          param: `x${i}`,
          body: deepBody
        };
      }

      const structure: ContractStructure = {
        type: 'spend',
        params: ['datum', 'redeemer', 'own_ref', 'tx'],
        redeemer: {
          variants: [],
          matchPattern: 'unknown'
        },
        checks: [],
        rawBody: deepBody
      };

      const code = generate(structure);
      
      // Should not contain ??? (depth limit failure marker)
      expect(code).not.toContain('???');
      // Should contain some nested functions
      expect(code).toContain('fn(');
    });

    it('handles BLS12-381 builtins', () => {
      const structure: ContractStructure = {
        type: 'spend',
        params: ['datum', 'redeemer', 'own_ref', 'tx'],
        redeemer: {
          variants: [],
          matchPattern: 'unknown'
        },
        checks: [],
        rawBody: {
          tag: 'app',
          func: {
            tag: 'app',
            func: { tag: 'builtin', name: 'bls12_381_G1_equal' },
            arg: { tag: 'var', name: 'a' }
          },
          arg: { tag: 'var', name: 'b' }
        } as any
      };

      const code = generate(structure);
      
      expect(code).toContain('g1_equal');
      expect(code).toContain('aiken/crypto/bls12_381');
    });
  });
});
