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
  });
});
