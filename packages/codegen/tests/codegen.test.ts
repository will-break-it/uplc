import { describe, it, expect } from 'vitest';
import { generate, postProcess, extractConstants, extractHelpers, detectTxFieldAccess, TX_FIELD_MAP } from '../src/index.js';
import type { ContractStructure } from '@uplc/patterns';
import type { UplcTerm } from '@uplc/parser';

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
      
      expect(code).toContain('validator script');
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

  describe('postProcess', () => {
    it('simplifies boolean if True else False', () => {
      const input = 'if cond { True } else { False }';
      const result = postProcess(input);
      expect(result).toBe('cond');
    });

    it('simplifies negated booleans if False else True', () => {
      const input = 'if cond { False } else { True }';
      const result = postProcess(input);
      expect(result).toBe('!(cond)');
    });

    it('preserves module paths with slashes', () => {
      const input = 'use aiken/crypto/bls12_381';
      const result = postProcess(input);
      expect(result).toBe('use aiken/crypto/bls12_381');
    });

    it('formats arithmetic between digits', () => {
      const input = '10+20';
      const result = postProcess(input);
      expect(result).toContain('10 + 20');
    });

    it('detects recursive patterns', () => {
      const input = 'fn(f) { (f)(f)(x) }';
      const result = postProcess(input);
      expect(result).toContain('Recursive function detected');
    });
  });

  describe('extractConstants', () => {
    it('extracts long hex strings as constants', () => {
      const input = 'check(#"a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4")';
      const { code, constants } = extractConstants(input);
      
      expect(constants.length).toBe(1);
      expect(constants[0]).toContain('SCRIPT_HASH_0');
      expect(code).toContain('SCRIPT_HASH_0');
      expect(code).not.toContain('#"a1b2c3');
    });

    it('reuses constants for repeated hex strings', () => {
      const hex = 'a'.repeat(64);
      const input = `check(#"${hex}") && verify(#"${hex}")`;
      const { code, constants } = extractConstants(input);
      
      expect(constants.length).toBe(1);
      expect(code.match(/POLICY_ID_0/g)?.length).toBe(2);
    });

    it('ignores short hex strings', () => {
      const input = 'check(#"a1b2c3")';
      const { code, constants } = extractConstants(input);
      
      expect(constants.length).toBe(0);
      expect(code).toBe(input);
    });
  });

  describe('extractHelpers', () => {
    it('detects identity function: fn(x) { x }', () => {
      const term: UplcTerm = {
        tag: 'app',
        func: {
          tag: 'lam',
          param: 'myId',
          body: { tag: 'var', name: 'y' }
        },
        arg: {
          tag: 'lam',
          param: 'x',
          body: { tag: 'var', name: 'x' }
        }
      };
      
      const helpers = extractHelpers(term);
      expect(helpers.has('myId')).toBe(true);
      expect(helpers.get('myId')?.pattern).toBe('identity');
      expect(helpers.get('myId')?.helperName).toBe('id');
      expect(helpers.get('myId')?.canInline).toBe(true);
    });

    it('detects apply function: fn(f, x) { f(x) }', () => {
      const term: UplcTerm = {
        tag: 'app',
        func: {
          tag: 'lam',
          param: 'apply',
          body: { tag: 'var', name: 'y' }
        },
        arg: {
          tag: 'lam',
          param: 'f',
          body: {
            tag: 'lam',
            param: 'x',
            body: {
              tag: 'app',
              func: { tag: 'var', name: 'f' },
              arg: { tag: 'var', name: 'x' }
            }
          }
        }
      };
      
      const helpers = extractHelpers(term);
      expect(helpers.has('apply')).toBe(true);
      expect(helpers.get('apply')?.pattern).toBe('apply');
    });

    it('detects compose function: fn(f, g, x) { f(g(x)) }', () => {
      const term: UplcTerm = {
        tag: 'app',
        func: {
          tag: 'lam',
          param: 'compose',
          body: { tag: 'var', name: 'unused' }
        },
        arg: {
          tag: 'lam',
          param: 'f',
          body: {
            tag: 'lam',
            param: 'g',
            body: {
              tag: 'lam',
              param: 'x',
              body: {
                tag: 'app',
                func: { tag: 'var', name: 'f' },
                arg: {
                  tag: 'app',
                  func: { tag: 'var', name: 'g' },
                  arg: { tag: 'var', name: 'x' }
                }
              }
            }
          }
        }
      };
      
      const helpers = extractHelpers(term);
      expect(helpers.has('compose')).toBe(true);
      expect(helpers.get('compose')?.pattern).toBe('compose');
    });
  });

  describe('TX_FIELD_MAP', () => {
    it('maps transaction field indices to names', () => {
      expect(TX_FIELD_MAP[0]).toBe('inputs');
      expect(TX_FIELD_MAP[1]).toBe('reference_inputs');
      expect(TX_FIELD_MAP[2]).toBe('outputs');
      expect(TX_FIELD_MAP[7]).toBe('validity_range');
      expect(TX_FIELD_MAP[8]).toBe('extra_signatories');
    });
  });
});
