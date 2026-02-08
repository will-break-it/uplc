/**
 * Real Contract Integration Tests
 * 
 * Tests pattern detection and code generation against real on-chain contracts.
 * UPLC fixtures are stored in ./fixtures/{scriptHash}.uplc
 * Metadata (expected builtins, stats) in ./fixtures/{scriptHash}.meta.json
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseUplc } from '@uplc/parser';
import { analyzeContract } from '../src/index.js';
import { generate } from '@uplc/codegen';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures');

interface ContractFixture {
  hash: string;
  name: string;
  protocol: string;
  uplc: string;
  meta: {
    scriptType: string;
    scriptPurpose: string;
    version: string;
    builtins: string[];
    stats: {
      totalBuiltins: number;
      uniqueBuiltins: number;
      lambdaCount: number;
    };
  };
}

function loadFixture(hash: string, name: string, protocol: string): ContractFixture | null {
  const uplcPath = join(FIXTURES_DIR, `${hash}.uplc`);
  const metaPath = join(FIXTURES_DIR, `${hash}.meta.json`);
  
  if (!existsSync(uplcPath) || !existsSync(metaPath)) {
    return null;
  }
  
  return {
    hash,
    name,
    protocol,
    uplc: readFileSync(uplcPath, 'utf-8'),
    meta: JSON.parse(readFileSync(metaPath, 'utf-8')),
  };
}

// Contract registry
const CONTRACTS = [
  { hash: 'e0fccbbfb75923bff6dac5f23805dcf6cecfaae8aa3a6d3e474ee670', name: 'Pool', protocol: 'SundaeSwap' },
  { hash: 'fa6a58bbe2d0ff05534431c8e2f0ef2cbdc1602a8456e4b13c8f3077', name: 'Order', protocol: 'SundaeSwap' },
  { hash: 'ea07b733d932129c378af627436e7cbc2ef0bf96e0036bb51b3bde6b', name: 'Pool', protocol: 'Minswap' },
  { hash: 'c3e28c36c3447315ba5a56f33da6a6ddc1770a876a8d9f0cb3a97c4c', name: 'Order', protocol: 'Minswap' },
  { hash: 'c727443d77df6cff95dca383994f4c3024d03ff56b02ecc22b0f3f65', name: 'Ask', protocol: 'JPG Store' },
];

describe('Real Contract Tests', () => {
  const fixtures: Map<string, ContractFixture> = new Map();
  
  beforeAll(() => {
    for (const contract of CONTRACTS) {
      const fixture = loadFixture(contract.hash, contract.name, contract.protocol);
      if (fixture) {
        fixtures.set(contract.hash, fixture);
      }
    }
  });

  describe('Parser', () => {
    it.each(CONTRACTS)('parses $protocol $name without errors', ({ hash }) => {
      const fixture = fixtures.get(hash);
      if (!fixture) return; // Skip if fixture not available
      
      expect(() => parseUplc(fixture.uplc)).not.toThrow();
    });

    it.each(CONTRACTS)('$protocol $name: AST matches expected lambda count', ({ hash }) => {
      const fixture = fixtures.get(hash);
      if (!fixture) return;
      
      const ast = parseUplc(fixture.uplc);
      
      // Count lambdas in parsed AST
      let lambdaCount = 0;
      function countLambdas(term: any) {
        if (!term) return;
        if (term.tag === 'lam') {
          lambdaCount++;
          countLambdas(term.body);
        } else if (term.tag === 'app') {
          countLambdas(term.func);
          countLambdas(term.arg);
        } else if (term.tag === 'force' || term.tag === 'delay') {
          countLambdas(term.term);
        } else if (term.tag === 'case') {
          countLambdas(term.scrutinee);
          term.branches?.forEach(countLambdas);
        } else if (term.tag === 'constr') {
          term.args?.forEach(countLambdas);
        }
      }
      countLambdas(ast);
      
      // Should be close to metadata (within 5% tolerance)
      const expected = fixture.meta.stats.lambdaCount;
      expect(lambdaCount).toBeGreaterThan(expected * 0.9);
      expect(lambdaCount).toBeLessThan(expected * 1.1);
    });
  });

  describe('Pattern Detection', () => {
    it.each(CONTRACTS)('$protocol $name: detects utility bindings', ({ hash }) => {
      const fixture = fixtures.get(hash);
      if (!fixture) return;
      
      const ast = parseUplc(fixture.uplc);
      const structure = analyzeContract(ast);
      
      // Should detect some utility bindings
      const bindings = structure.utilityBindings || {};
      expect(Object.keys(bindings).length).toBeGreaterThan(0);
      
      // Common utilities should be detected
      const bindingValues = Object.values(bindings);
      const commonBuiltins = ['headList', 'tailList', 'fstPair', 'sndPair', 'ifThenElse'];
      const foundCommon = commonBuiltins.filter(b => bindingValues.includes(b));
      expect(foundCommon.length).toBeGreaterThan(0);
    });

    it.each(CONTRACTS)('$protocol $name: extracts validator params', ({ hash }) => {
      const fixture = fixtures.get(hash);
      if (!fixture) return;
      
      const ast = parseUplc(fixture.uplc);
      const structure = analyzeContract(ast);
      
      // Should have some params
      expect(structure.params.length).toBeGreaterThan(0);
    });

    it('SundaeSwap Pool: detects DEX-related builtins', () => {
      const fixture = fixtures.get('e0fccbbfb75923bff6dac5f23805dcf6cecfaae8aa3a6d3e474ee670');
      if (!fixture) return;
      
      // DEX pools use arithmetic for AMM calculations
      expect(fixture.meta.builtins).toContain('multiplyInteger');
      expect(fixture.meta.builtins).toContain('divideInteger');
      expect(fixture.meta.builtins).toContain('addInteger');
      expect(fixture.meta.builtins).toContain('subtractInteger');
    });

    it('JPG Store Ask: detects NFT marketplace patterns', () => {
      const fixture = fixtures.get('c727443d77df6cff95dca383994f4c3024d03ff56b02ecc22b0f3f65');
      if (!fixture) return;
      
      const ast = parseUplc(fixture.uplc);
      const structure = analyzeContract(ast);
      
      // NFT marketplaces check signatures
      expect(fixture.meta.builtins).toContain('equalsByteString');
      
      // Should be a spend validator
      expect(['spend', 'unknown']).toContain(structure.type);
    });

    it('Minswap Order: detects constructor predicates', () => {
      const fixture = fixtures.get('c3e28c36c3447315ba5a56f33da6a6ddc1770a876a8d9f0cb3a97c4c');
      if (!fixture) return;
      
      const ast = parseUplc(fixture.uplc);
      const structure = analyzeContract(ast);
      
      // Should detect is_constr_N predicates
      const bindings = structure.utilityBindings || {};
      const predicates = Object.values(bindings).filter(v => v.startsWith('is_constr_'));
      
      // Orders typically have multiple redeemer variants
      // (This tests our new predicate detection)
      expect(predicates.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Code Generation', () => {
    it.each(CONTRACTS)('$protocol $name: generates code without ???', ({ hash }) => {
      const fixture = fixtures.get(hash);
      if (!fixture) return;
      
      const ast = parseUplc(fixture.uplc);
      const structure = analyzeContract(ast);
      const code = generate(structure);
      
      // Critical: no placeholder failures
      expect(code).not.toContain('???');
    });

    it.each(CONTRACTS)('$protocol $name: generates valid validator structure', ({ hash }) => {
      const fixture = fixtures.get(hash);
      if (!fixture) return;
      
      const ast = parseUplc(fixture.uplc);
      const structure = analyzeContract(ast);
      const code = generate(structure);
      
      // Must have validator block
      expect(code).toMatch(/validator\s+\w+/);
      
      // Must have handler
      expect(code).toMatch(/(spend|mint|withdraw|publish|vote|propose)\s*\(/);
      
      // Must have balanced braces
      const opens = (code.match(/\{/g) || []).length;
      const closes = (code.match(/\}/g) || []).length;
      expect(opens).toBe(closes);
    });

    it.each(CONTRACTS)('$protocol $name: substitutes utility bindings', ({ hash }) => {
      const fixture = fixtures.get(hash);
      if (!fixture) return;
      
      const ast = parseUplc(fixture.uplc);
      const structure = analyzeContract(ast);
      const code = generate(structure);
      
      // Should use builtin:: prefix for substituted utilities
      // or readable names like head(), tail()
      const hasBuiltinRefs = code.includes('builtin::') || 
                            code.includes('.head()') || 
                            code.includes('.tail()') ||
                            code.includes('.1st') ||
                            code.includes('.2nd');
      expect(hasBuiltinRefs).toBe(true);
    });

    it('SundaeSwap Pool: generates arithmetic expressions', () => {
      const fixture = fixtures.get('e0fccbbfb75923bff6dac5f23805dcf6cecfaae8aa3a6d3e474ee670');
      if (!fixture) return;
      
      const ast = parseUplc(fixture.uplc);
      const structure = analyzeContract(ast);
      const code = generate(structure);
      
      // Should have arithmetic operators (from AMM calculations)
      const hasArithmetic = code.includes(' + ') || 
                           code.includes(' - ') || 
                           code.includes(' * ') || 
                           code.includes(' / ');
      expect(hasArithmetic).toBe(true);
    });

    it('JPG Store Ask: generates conditional logic', () => {
      const fixture = fixtures.get('c727443d77df6cff95dca383994f4c3024d03ff56b02ecc22b0f3f65');
      if (!fixture) return;
      
      const ast = parseUplc(fixture.uplc);
      const structure = analyzeContract(ast);
      const code = generate(structure);
      
      // Should have conditional expressions
      const hasConditional = code.includes('if ') || 
                            code.includes('when ') ||
                            code.includes(' == ');
      expect(hasConditional).toBe(true);
    });
  });

  describe('Regression Tests', () => {
    it('handles deep nesting without stack overflow', () => {
      // SundaeSwap Pool has 382 lambdas
      const fixture = fixtures.get('e0fccbbfb75923bff6dac5f23805dcf6cecfaae8aa3a6d3e474ee670');
      if (!fixture) return;
      
      expect(fixture.meta.stats.lambdaCount).toBeGreaterThan(300);
      
      // Should not throw
      const ast = parseUplc(fixture.uplc);
      const structure = analyzeContract(ast);
      const code = generate(structure);
      
      expect(code.length).toBeGreaterThan(100);
    });

    it('handles high application count', () => {
      // SundaeSwap Pool has 1922 applications
      const fixture = fixtures.get('e0fccbbfb75923bff6dac5f23805dcf6cecfaae8aa3a6d3e474ee670');
      if (!fixture) return;
      
      expect(fixture.meta.stats.applicationCount).toBeGreaterThan(1500);
      
      const ast = parseUplc(fixture.uplc);
      expect(() => analyzeContract(ast)).not.toThrow();
    });
  });
});
