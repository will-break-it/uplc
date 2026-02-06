import { describe, it, expect } from 'vitest';
import { parseUplc } from '@uplc/parser';
import { analyzeContract, detectValidatorEntry, detectChecks } from '../src/index.js';

describe('Validator Detection', () => {
  it('detects spend validator (3 params)', () => {
    const uplc = '(lam datum (lam redeemer (lam ctx (con bool True))))';
    const ast = parseUplc(uplc);
    const entry = detectValidatorEntry(ast);
    
    expect(entry.type).toBe('validator');
    expect(entry.params).toEqual(['datum', 'redeemer', 'ctx']);
  });
  
  it('detects minting policy (2 params)', () => {
    const uplc = '(lam redeemer (lam ctx (con bool True)))';
    const ast = parseUplc(uplc);
    const entry = detectValidatorEntry(ast);
    
    expect(entry.type).toBe('minting_policy');
    expect(entry.params).toEqual(['redeemer', 'ctx']);
  });
  
  it('detects unknown for 1 param', () => {
    const uplc = '(lam x (con bool True))';
    const ast = parseUplc(uplc);
    const entry = detectValidatorEntry(ast);
    
    expect(entry.type).toBe('unknown');
  });
});

describe('Check Detection', () => {
  it('finds signature verification', () => {
    const uplc = '(lam d (lam r (lam c (builtin verifyEd25519Signature))))';
    const ast = parseUplc(uplc);
    const structure = analyzeContract(ast);
    
    const sigCheck = structure.checks.find(c => c.type === 'signature');
    expect(sigCheck).toBeDefined();
    expect(sigCheck?.builtin).toBe('verifyEd25519Signature');
  });
  
  it('finds equality checks', () => {
    const uplc = '(lam d (lam r (lam c [[(builtin equalsByteString) (var x)] (var y)])))';
    const ast = parseUplc(uplc);
    const structure = analyzeContract(ast);
    
    const eqCheck = structure.checks.find(c => c.type === 'equality');
    expect(eqCheck).toBeDefined();
    expect(eqCheck?.builtin).toBe('equalsByteString');
  });
  
  it('finds comparison checks', () => {
    const uplc = '(lam d (lam r (lam c [[(builtin lessThanInteger) (var x)] (var y)])))';
    const ast = parseUplc(uplc);
    const structure = analyzeContract(ast);
    
    const cmpCheck = structure.checks.find(c => c.type === 'comparison');
    expect(cmpCheck).toBeDefined();
    expect(cmpCheck?.builtin).toBe('lessThanInteger');
  });
});

describe('Full Contract Analysis', () => {
  it('analyzes simple always-true validator', () => {
    const uplc = '(lam datum (lam redeemer (lam ctx (con bool True))))';
    const ast = parseUplc(uplc);
    const structure = analyzeContract(ast);
    
    expect(structure.type).toBe('validator');
    expect(structure.params).toHaveLength(3);
    expect(structure.redeemer.variants).toHaveLength(0);
  });
  
  it('analyzes validator with ifThenElse', () => {
    // Simple conditional that doesn't match redeemer pattern
    const uplc = `(lam d (lam r (lam c 
      (app (app (app (force (builtin ifThenElse)) (con bool True)) 
        (con integer 1)) 
        (con integer 0)))))`;
    const ast = parseUplc(uplc);
    const structure = analyzeContract(ast);
    
    expect(structure.type).toBe('validator');
    expect(structure.checks.length).toBeGreaterThanOrEqual(0);
  });
});

describe('Redeemer Pattern Detection', () => {
  it('detects constructor matching pattern', () => {
    // Pattern: if equalsInteger(fstPair(unConstrData(r)), 0) then ... else ...
    // Using (app ...) syntax since bracket syntax has limitations with parens
    const uplc = `(lam d (lam r (lam c 
      (app (app (app (force (builtin ifThenElse)) 
        (app (app (builtin equalsInteger) 
          (app (force (builtin fstPair)) (app (builtin unConstrData) (var r)))) 
          (con integer 0))) 
        (con bool True)) 
        (con bool False)))))`;
    
    const ast = parseUplc(uplc);
    const structure = analyzeContract(ast);
    
    expect(structure.redeemer.matchPattern).toBe('constructor');
    expect(structure.redeemer.variants.length).toBeGreaterThanOrEqual(1);
    expect(structure.redeemer.variants[0]?.index).toBe(0);
  });
});
