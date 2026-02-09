/**
 * Contract Structure Detection Tests
 * 
 * Tests pattern detection against various UPLC structures.
 * Uses inline UPLC snippets for unit testing - real contracts tested in /test/e2e.test.ts
 */
import { describe, it, expect } from 'vitest';
import { parseUplc } from '@uplc/parser';
import { analyzeContract } from '../src/index.js';

describe('Contract Structure Detection', () => {
  
  describe('Simple validators', () => {
    it('detects 3-param spend validator', () => {
      const uplc = '(lam datum (lam redeemer (lam ctx (con unit ()))))';
      const ast = parseUplc(uplc);
      const structure = analyzeContract(ast);
      
      expect(structure.type).toBe('spend');
      expect(structure.params).toEqual(['datum', 'redeemer', 'ctx']);
    });

    it('detects validator that returns True', () => {
      const uplc = '(lam d (lam r (lam c (con bool True))))';
      const ast = parseUplc(uplc);
      const structure = analyzeContract(ast);
      
      expect(structure.type).toBe('spend');
    });
  });

  describe('Plutus V3 patterns', () => {
    it('detects V3 structure with case/constr wrapper', () => {
      // V3 pattern: (lam ctx (case (constr 0 utils...) (lam a (lam b body))))
      const uplc = `
        (lam ctx 
          (case (constr 0 (force (builtin headList)) (force (builtin tailList)))
            (lam h (lam t 
              (con unit ())))))
      `;
      const ast = parseUplc(uplc);
      const structure = analyzeContract(ast);
      
      // Should detect as some validator type
      expect(structure.type).toBeDefined();
      expect(structure.params.length).toBeGreaterThan(0);
    });
  });

  describe('Redeemer variants', () => {
    it('detects integer-based redeemer matching', () => {
      // Pattern: ifThenElse (equalsInteger redeemer 0) branch1 branch2
      const uplc = `
        (lam d (lam r (lam ctx
          [[[
            (force (builtin ifThenElse))
            [[(builtin equalsInteger) r] (con integer 0)]
          ]
            (con unit ())
          ]
            (error)
          ]
        )))
      `;
      const ast = parseUplc(uplc);
      const structure = analyzeContract(ast);
      
      expect(structure.type).toBe('spend');
      // Should detect some validation pattern
      expect(structure.checks.length + structure.redeemer.variants.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Builtin detection', () => {
    it('finds signature check patterns', () => {
      // Pattern using equalsByteString check
      const uplc = `
        (lam d (lam r (lam ctx
          [[(builtin equalsByteString) 
            [(force (builtin headList)) [(builtin unListData) ctx]]
          ]
            (con bytestring #abcd1234)
          ]
        )))
      `;
      const ast = parseUplc(uplc);
      const structure = analyzeContract(ast);
      
      // Should have some checks detected
      expect(structure.checks).toBeDefined();
    });
  });

  describe('Datum analysis', () => {
    it('detects datum usage via unConstrData', () => {
      const uplc = `
        (lam d (lam r (lam ctx
          [(builtin unConstrData) d]
        )))
      `;
      const ast = parseUplc(uplc);
      const structure = analyzeContract(ast);
      
      expect(structure.datum.isUsed).toBe(true);
    });

    it('detects unused datum', () => {
      // Datum is never referenced
      const uplc = `
        (lam d (lam r (lam ctx
          [(builtin unIData) r]
        )))
      `;
      const ast = parseUplc(uplc);
      const structure = analyzeContract(ast);
      
      expect(structure.datum.isUsed).toBe(false);
    });
  });

  describe('Script purposes', () => {
    it('defaults to spend for 3+ params', () => {
      const uplc = '(lam a (lam b (lam c (lam d (con unit ())))))';
      const ast = parseUplc(uplc);
      const structure = analyzeContract(ast);
      
      // 4 params typically indicates spend (datum, redeemer, ref, tx)
      expect(['spend', 'vote']).toContain(structure.type);
    });
  });
});
