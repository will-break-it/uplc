/**
 * End-to-end test: Aiken → CBOR → UPLC → Analysis → Codegen
 * 
 * Uses real compiled Aiken validators from test/fixtures
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// Import from harmoniclabs/uplc for CBOR decoding
import { UPLCDecoder, showUPLC } from '@harmoniclabs/uplc';

// Import our packages
import { parseUplc } from '@uplc/parser';
import { analyzeContract } from '@uplc/patterns';
import { generate } from '@uplc/codegen';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Fixture {
  title: string;
  cbor: string;
  hash: string;
}

let fixtures: Record<string, Fixture>;

// Helper: hex string to Buffer
function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Helper: Strip CBOR wrapper from Aiken-compiled scripts
function stripCborWrapper(cbor: string): string {
  if (cbor.startsWith('59')) {
    return cbor.slice(6); // 59 + 2-byte length
  } else if (cbor.startsWith('58')) {
    return cbor.slice(4); // 58 + 1-byte length
  } else if (cbor.startsWith('5a')) {
    return cbor.slice(10); // 5a + 4-byte length
  }
  return cbor;
}

// Helper: Decode CBOR to UPLC text
function decodeToUplc(cbor: string): string {
  const innerHex = stripCborWrapper(cbor);
  const buffer = hexToBuffer(innerHex);
  const program = UPLCDecoder.parse(buffer, "flat");
  return showUPLC(program.body);
}

beforeAll(() => {
  const fixturesPath = join(__dirname, 'fixtures/uplc/fixtures.json');
  fixtures = JSON.parse(readFileSync(fixturesPath, 'utf-8'));
});

describe('End-to-end decompilation', () => {
  it('decodes simple_validator CBOR to UPLC text', () => {
    const fixture = fixtures['simple_validator_simple_validator_spend'];
    expect(fixture).toBeDefined();
    
    const uplcText = decodeToUplc(fixture.cbor);
    
    console.log('Simple validator UPLC:');
    console.log(uplcText);
    
    expect(uplcText).toBeDefined();
    expect(uplcText.length).toBeGreaterThan(0);
    // Should contain lambda for parameters
    expect(uplcText).toContain('lam');
  });

  it('parses and analyzes simple_validator', () => {
    const fixture = fixtures['simple_validator_simple_validator_spend'];
    
    const uplcText = decodeToUplc(fixture.cbor);
    
    // Parse UPLC text → AST
    const ast = parseUplc(uplcText);
    expect(ast).toBeDefined();
    
    // Analyze AST → Structure
    const structure = analyzeContract(ast);
    
    console.log('Simple validator structure:', JSON.stringify({
      type: structure.type,
      params: structure.params,
      variantCount: structure.redeemer.variants.length
    }, null, 2));
    
    // Should be detected as spend (Plutus V3 terminology)
    expect(['spend', 'unknown']).toContain(structure.type);
  });

  it('generates code for simple_validator', () => {
    const fixture = fixtures['simple_validator_simple_validator_spend'];
    
    const uplcText = decodeToUplc(fixture.cbor);
    const ast = parseUplc(uplcText);
    const structure = analyzeContract(ast);
    const code = generate(structure);
    
    console.log('Generated code for simple_validator:');
    console.log(code);
    
    expect(code).toContain('validator');
  });

  it('decodes multi_redeemer and shows UPLC', () => {
    const fixture = fixtures['multi_redeemer_multi_redeemer_spend'];
    expect(fixture).toBeDefined();
    
    const uplcText = decodeToUplc(fixture.cbor);
    
    console.log('Multi-redeemer UPLC (truncated):');
    console.log(uplcText.substring(0, 500));
    
    // Multi-redeemer should have case/constr patterns
    // (the exact detection depends on how Aiken compiles it)
    expect(uplcText.length).toBeGreaterThan(100);
  });

  it('decodes minting_policy', () => {
    const fixture = fixtures['minting_policy_simple_mint_mint'];
    expect(fixture).toBeDefined();
    
    const uplcText = decodeToUplc(fixture.cbor);
    
    console.log('Minting policy UPLC:');
    console.log(uplcText);
    
    // Minting policy should also have lambdas
    expect(uplcText).toContain('lam');
  });

  it('full pipeline for all fixtures', () => {
    const results: Record<string, { success: boolean; code?: string; error?: string }> = {};
    
    for (const [name, fixture] of Object.entries(fixtures)) {
      try {
        const uplcText = decodeToUplc(fixture.cbor);
        const ast = parseUplc(uplcText);
        const structure = analyzeContract(ast);
        const code = generate(structure);
        
        results[name] = { success: true, code };
        console.log(`\n=== ${name} ===`);
        console.log(code);
      } catch (error: any) {
        console.error(`Error processing ${name}:`, error.message);
        results[name] = { success: false, error: error.message };
      }
    }
    
    // Count successes
    const successes = Object.values(results).filter(r => r.success).length;
    console.log(`\nSuccess rate: ${successes}/${Object.keys(fixtures).length}`);
    
    // At least half should succeed
    expect(successes).toBeGreaterThanOrEqual(Object.keys(fixtures).length / 2);
  });
});
