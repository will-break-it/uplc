import { describe, it, expect } from 'vitest';
import { parseUplc } from '@uplc/parser';
import { 
  analyzeContract, 
  detectValidator, 
  findValidationChecks,
  flattenApp,
  getBuiltinName,
  referencesVar
} from '../src/index.js';

describe('Validator Detection', () => {
  it('detects a simple always-true validator', () => {
    const source = `
      (lam datum
        (lam redeemer
          (lam ctx
            (con unit ()))))
    `;
    const ast = parseUplc(source);
    const result = analyzeContract(ast);
    
    expect(result.type).toBe('spend');
    expect(result.params).toEqual(['datum', 'redeemer', 'ctx']);
    expect(result.rawBody).toEqual({ tag: 'con', type: 'unit', value: { tag: 'unit' } });
  });

  it('detects a minting policy (2 params)', () => {
    const source = `
      (lam redeemer
        (lam ctx
          (con unit ())))
    `;
    const ast = parseUplc(source);
    const result = analyzeContract(ast);
    
    expect(result.type).toBe('mint');
    expect(result.params).toEqual(['redeemer', 'ctx']);
  });

  it('detects mint type for single param', () => {
    // Single param scripts are typically minting policies
    const source = '(lam x (var x))';
    const ast = parseUplc(source);
    const result = analyzeContract(ast);
    
    expect(result.type).toBe('mint');
    expect(result.params).toEqual(['x']);
  });

  it('handles deeply nested lambdas (returns all params)', () => {
    const source = `
      (lam d
        (lam r
          (lam ctx
            (lam extra
              (var extra)))))
    `;
    const ast = parseUplc(source);
    const result = analyzeContract(ast);
    
    expect(result.type).toBe('spend');
    // All params are now returned (no artificial slicing)
    expect(result.params).toEqual(['d', 'r', 'ctx', 'extra']);
  });

  it('detects utility bindings from applied builtins', () => {
    // Pattern: [[lam a [lam b BODY]] util_a] util_b]
    // Simpler test with just 2 utility bindings
    const source = `
      [[
        (lam a
          (lam b
            (lam datum
              (lam redeemer
                (con unit ())))))
        (force (builtin headList))]
        (force (builtin tailList))]
    `;
    const ast = parseUplc(source);
    const result = detectValidator(ast);
    
    expect(result.utilityBindings).toBeDefined();
    expect(result.utilityBindings?.['a']).toBe('headList');
    expect(result.utilityBindings?.['b']).toBe('tailList');
    expect(result.params).toContain('datum');
    expect(result.params).toContain('redeemer');
    // a and b should NOT be in params (they're utilities)
    expect(result.params).not.toContain('a');
    expect(result.params).not.toContain('b');
  });
});

describe('Redeemer Variant Detection', () => {
  it('detects a single redeemer variant (constructor 0)', () => {
    // This validator checks if redeemer constructor == 0
    const source = `
      (lam datum
        (lam redeemer
          (lam ctx
            [[[
              (force (builtin ifThenElse))
              [[
                (force (builtin equalsInteger))
                [(force (force (builtin fstPair)))
                  [(force (builtin unConstrData)) (var redeemer)]]
              ] (con integer 0)]
            ] (con unit ())]
            (error)])))
    `;
    const ast = parseUplc(source);
    const result = analyzeContract(ast);
    
    expect(result.redeemer.matchPattern).toBe('constructor');
    expect(result.redeemer.variants).toHaveLength(1);
    expect(result.redeemer.variants[0].index).toBe(0);
    expect(result.redeemer.variants[0].name).toBe('variant_0');
  });

  it('detects multiple redeemer variants', () => {
    // Validator that checks constructor 0, else checks constructor 1
    const source = `
      (lam datum
        (lam redeemer
          (lam ctx
            [[[
              (force (builtin ifThenElse))
              [[
                (force (builtin equalsInteger))
                [(force (force (builtin fstPair)))
                  [(force (builtin unConstrData)) (var redeemer)]]
              ] (con integer 0)]
            ] (con unit ())]
            [[[
              (force (builtin ifThenElse))
              [[
                (force (builtin equalsInteger))
                [(force (force (builtin fstPair)))
                  [(force (builtin unConstrData)) (var redeemer)]]
              ] (con integer 1)]
            ] (con unit ())]
            (error)]])))
    `;
    const ast = parseUplc(source);
    const result = analyzeContract(ast);
    
    expect(result.redeemer.matchPattern).toBe('constructor');
    expect(result.redeemer.variants).toHaveLength(2);
    expect(result.redeemer.variants[0].index).toBe(0);
    expect(result.redeemer.variants[1].index).toBe(1);
  });

  it('reports unknown pattern when no constructor matching', () => {
    const source = `
      (lam datum
        (lam redeemer
          (lam ctx
            (con unit ()))))
    `;
    const ast = parseUplc(source);
    const result = analyzeContract(ast);
    
    // No variants found, pattern is unknown
    expect(result.redeemer.variants).toHaveLength(0);
    expect(result.redeemer.matchPattern).toBe('unknown');
  });
});

describe('Validation Check Detection', () => {
  it('detects equalsInteger check', () => {
    const source = `
      (lam datum
        (lam redeemer
          (lam ctx
            [[[
              (force (builtin ifThenElse))
              [[(force (builtin equalsInteger)) (var datum)] (con integer 42)]
            ] (con unit ())]
            (error)])))
    `;
    const ast = parseUplc(source);
    const result = analyzeContract(ast);

    const equalityChecks = result.checks.filter(c => c.builtin === 'equalsInteger');
    expect(equalityChecks.length).toBeGreaterThan(0);
    // equalsInteger is now classified as 'comparison' (semantic improvement)
    expect(equalityChecks[0].type).toBe('comparison');
  });

  it('detects equalsByteString check', () => {
    const source = `
      (lam datum
        (lam redeemer
          (lam ctx
            [[[
              (force (builtin ifThenElse))
              [[(force (builtin equalsByteString)) (var datum)] (con bytestring #deadbeef)]
            ] (con unit ())]
            (error)])))
    `;
    const ast = parseUplc(source);
    const result = analyzeContract(ast);
    
    const sigChecks = result.checks.filter(c => c.builtin === 'equalsByteString');
    expect(sigChecks.length).toBeGreaterThan(0);
    // equalsByteString without signatory context is classified as 'equality'
    expect(sigChecks[0].type).toBe('equality');
  });

  it('detects lessThanInteger comparison', () => {
    const source = `
      (lam datum
        (lam redeemer
          (lam ctx
            [[[
              (force (builtin ifThenElse))
              [[(force (builtin lessThanInteger)) (var datum)] (con integer 100)]
            ] (con unit ())]
            (error)])))
    `;
    const ast = parseUplc(source);
    const result = analyzeContract(ast);
    
    const comparisonChecks = result.checks.filter(c => c.builtin === 'lessThanInteger');
    expect(comparisonChecks.length).toBeGreaterThan(0);
    expect(comparisonChecks[0].type).toBe('comparison');
  });

  it('detects verifyEd25519Signature', () => {
    const source = `
      (lam datum
        (lam redeemer
          (lam ctx
            [[[
              (force (builtin ifThenElse))
              [[[(builtin verifyEd25519Signature) (var datum)] (con bytestring #00)] (con bytestring #01)]
            ] (con unit ())]
            (error)])))
    `;
    const ast = parseUplc(source);
    const result = analyzeContract(ast);
    
    const sigChecks = result.checks.filter(c => c.builtin === 'verifyEd25519Signature');
    expect(sigChecks.length).toBeGreaterThan(0);
    // verifyEd25519Signature is now classified as 'signer' (more semantic)
    expect(sigChecks[0].type).toBe('signer');
  });

  it('detects multiple checks in complex validator', () => {
    const source = `
      (lam datum
        (lam redeemer
          (lam ctx
            [[[
              (force (builtin ifThenElse))
              [[(force (builtin equalsInteger)) (var datum)] (con integer 42)]
            ] [[[
                (force (builtin ifThenElse))
                [[(force (builtin lessThanInteger)) (var redeemer)] (con integer 100)]
              ] (con unit ())]
              (error)]]
            (error)])))
    `;
    const ast = parseUplc(source);
    const result = analyzeContract(ast);
    
    // Verify we found the expected check types
    expect(result.checks.filter(c => c.builtin === 'equalsInteger').length).toBeGreaterThanOrEqual(1);
    expect(result.checks.filter(c => c.builtin === 'lessThanInteger').length).toBeGreaterThanOrEqual(1);
  });

  it('does not flag arithmetic operations as checks', () => {
    const source = `
      (lam datum
        (lam redeemer
          (lam ctx
            [[(force (force (builtin addInteger))) (var datum)] (var redeemer)])))
    `;
    const ast = parseUplc(source);
    const result = analyzeContract(ast);
    
    // addInteger should not be flagged as a check
    expect(result.checks.filter(c => c.builtin === 'addInteger')).toHaveLength(0);
  });
});

describe('Traversal Utilities', () => {
  it('flattenApp extracts all arguments', () => {
    const source = '[[[(builtin addInteger) (var a)] (var b)] (var c)]';
    const ast = parseUplc(source);
    
    const parts = flattenApp(ast);
    expect(parts).toHaveLength(4);
    expect(parts[0]).toEqual({ tag: 'builtin', name: 'addInteger' });
    expect(parts[1]).toEqual({ tag: 'var', name: 'a' });
    expect(parts[2]).toEqual({ tag: 'var', name: 'b' });
    expect(parts[3]).toEqual({ tag: 'var', name: 'c' });
  });

  it('getBuiltinName extracts name through force', () => {
    const source = '(force (force (builtin fstPair)))';
    const ast = parseUplc(source);
    
    expect(getBuiltinName(ast)).toBe('fstPair');
  });

  it('referencesVar detects variable usage', () => {
    const source = '(lam x [(var f) (var x)])';
    const ast = parseUplc(source);
    
    // x is bound by the lambda, so it's not a free reference
    expect(referencesVar(ast, 'x')).toBe(false);
    // f is free (not bound)
    expect(referencesVar(ast, 'f')).toBe(true);
    expect(referencesVar(ast, 'y')).toBe(false);
  });

  it('referencesVar finds free variables', () => {
    const source = '[(var f) (var x)]';
    const ast = parseUplc(source);
    
    expect(referencesVar(ast, 'x')).toBe(true);
    expect(referencesVar(ast, 'f')).toBe(true);
    expect(referencesVar(ast, 'y')).toBe(false);
  });

  it('referencesVar respects shadowing', () => {
    const source = '(lam x (lam x (var x)))';
    const ast = parseUplc(source);
    
    // x is always bound, so there's no free reference to x
    expect(referencesVar(ast, 'x')).toBe(false);
  });
});

describe('Integration: Full Contract Analysis', () => {
  it('analyzes a realistic validator structure', () => {
    // A validator that:
    // 1. Checks if redeemer constructor is 0 (Claim) or 1 (Cancel)
    // 2. For Claim: checks if datum == 42
    const source = `
      (lam datum
        (lam redeemer
          (lam ctx
            [[[
              (force (builtin ifThenElse))
              [[
                (force (builtin equalsInteger))
                [(force (force (builtin fstPair)))
                  [(force (builtin unConstrData)) (var redeemer)]]
              ] (con integer 0)]
            ]
            -- Claim branch
            [[[
              (force (builtin ifThenElse))
              [[(force (builtin equalsInteger)) (var datum)] (con integer 42)]
            ] (con unit ())]
            (error)]
            ]
            -- Else (Cancel branch)
            [[[
              (force (builtin ifThenElse))
              [[
                (force (builtin equalsInteger))
                [(force (force (builtin fstPair)))
                  [(force (builtin unConstrData)) (var redeemer)]]
              ] (con integer 1)]
            ]
            [[[
              (force (builtin ifThenElse))
              [[(force (builtin lessThanInteger)) (var datum)] (con integer 100)]
            ] (con unit ())]
            (error)]
            ]
            (error)]])))
    `;
    
    const ast = parseUplc(source);
    const result = analyzeContract(ast);
    
    // Basic structure
    expect(result.type).toBe('spend');
    expect(result.params).toEqual(['datum', 'redeemer', 'ctx']);
    
    // Redeemer variants
    expect(result.redeemer.matchPattern).toBe('constructor');
    expect(result.redeemer.variants.length).toBeGreaterThanOrEqual(1);
    
    // Validation checks
    expect(result.checks.some(c => c.builtin === 'equalsInteger')).toBe(true);
    expect(result.checks.some(c => c.builtin === 'lessThanInteger')).toBe(true);
  });

  it('handles empty/trivial validators gracefully', () => {
    const source = '(error)';
    const ast = parseUplc(source);
    const result = analyzeContract(ast);
    
    expect(result.type).toBe('unknown');
    expect(result.params).toEqual([]);
    expect(result.redeemer.variants).toHaveLength(0);
    expect(result.rawBody).toEqual({ tag: 'error' });
  });
});
