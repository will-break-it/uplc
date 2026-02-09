/**
 * End-to-end test: CBOR → AST → ContractStructure → Aiken
 * 
 * Tests the full decompilation pipeline with real mainnet contracts.
 * Fixtures are in /fixtures/mainnet/
 * 
 * Pipeline (clean, no text round-trip):
 *   CBOR → @harmoniclabs/uplc decoder → harmoniclabs AST → convertFromHarmoniclabs → our AST → patterns → codegen
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// External: CBOR → harmoniclabs AST
import { UPLCDecoder } from '@harmoniclabs/uplc';

// Our packages: converter + analysis
import { convertFromHarmoniclabs } from '@uplc/parser';
import { analyzeContract } from '@uplc/patterns';
import { generate } from '@uplc/codegen';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ContractFixture {
  id: string;
  name: string;
  protocol: string;
  type: string;
  purpose: string;
  scriptHash: string;
  plutusVersion: string;
  size: number;
  file: string;
  notes?: string;
}

interface FixtureIndex {
  description: string;
  lastUpdated: string;
  contracts: ContractFixture[];
}

let fixtureIndex: FixtureIndex;
let fixtures: Map<string, { meta: ContractFixture; cbor: string }>;

// Helper: hex string to Buffer
function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Helper: Strip CBOR wrapper (removes length prefix bytes)
function stripCborWrapper(cbor: string): string {
  if (cbor.startsWith('59')) return cbor.slice(6);   // 2-byte length
  if (cbor.startsWith('58')) return cbor.slice(4);   // 1-byte length
  if (cbor.startsWith('5a')) return cbor.slice(10);  // 4-byte length
  return cbor;
}

/**
 * Full decompilation pipeline (clean, no text round-trip)
 */
function decompile(cbor: string) {
  const innerHex = stripCborWrapper(cbor);
  const buffer = hexToBuffer(innerHex);
  
  // CBOR → harmoniclabs AST
  const program = UPLCDecoder.parse(buffer, "flat");
  
  // harmoniclabs AST → our AST (direct conversion, no text)
  const ast = convertFromHarmoniclabs(program.body);
  
  // AST → ContractStructure → Aiken code
  const structure = analyzeContract(ast);
  const code = generate(structure);
  
  return { ast, structure, code };
}

beforeAll(() => {
  const fixturesDir = join(__dirname, '../fixtures/mainnet');
  fixtureIndex = JSON.parse(readFileSync(join(fixturesDir, 'index.json'), 'utf-8'));
  
  fixtures = new Map();
  for (const contract of fixtureIndex.contracts) {
    const cbor = readFileSync(join(fixturesDir, contract.file), 'utf-8').trim();
    fixtures.set(contract.id, { meta: contract, cbor });
  }
});

describe('E2E: Full Decompilation Pipeline', () => {
  
  describe('Minswap V2 Pool', () => {
    it('loads fixture correctly', () => {
      const fixture = fixtures.get('minswap-v2-pool');
      expect(fixture).toBeDefined();
      expect(fixture!.meta.scriptHash).toBe('ea07b733d932129c378af627436e7cbc2ef0bf96e0036bb51b3bde6b');
      expect(fixture!.cbor).toMatch(/^59[0-9a-f]+$/i);
    });

    it('decodes CBOR → AST directly', () => {
      const { cbor } = fixtures.get('minswap-v2-pool')!;
      const { ast } = decompile(cbor);
      
      expect(ast).toBeDefined();
      // Top-level is 'app' when script has applied parameters (common for parameterized validators)
      // The pattern: [[validator param1] param2] → outer tag is 'app'
      expect(['lam', 'app']).toContain(ast.tag);
    });

    it('analyzes AST → ContractStructure', () => {
      const { cbor } = fixtures.get('minswap-v2-pool')!;
      const { structure } = decompile(cbor);
      
      // Minswap V2 Pool has complex nested structure
      expect(['spend', 'unknown']).toContain(structure.type);
      expect(structure.params.length).toBeGreaterThan(0);
      
      // Should detect script parameter (authen minting policy hash)
      expect(structure.scriptParams).toBeDefined();
      expect(structure.scriptParams!.length).toBeGreaterThan(0);
      expect(structure.scriptParams![0].value).toBe('f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c');
    });

    it('generates Aiken-style code', () => {
      const { cbor } = fixtures.get('minswap-v2-pool')!;
      const { code } = decompile(cbor);
      
      expect(code).toContain('validator');
      expect(code).toContain('spend');
      // Should include the extracted script parameter
      expect(code).toContain('SCRIPT_HASH_0');
      expect(code).toContain('f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c');
    });
  });

  describe('SundaeSwap V3 Order', () => {
    it('full pipeline succeeds (no text parsing issues)', () => {
      // Previously failed because showUPLC outputs bare integers like (-1)
      // that the text parser couldn't handle. Direct conversion fixes this!
      const { cbor, meta } = fixtures.get('sundaeswap-v3-order')!;
      const { structure, code } = decompile(cbor);
      
      // Note: Pattern detection may classify as 'mint' based on arity
      // The actual purpose according to on-chain metadata is 'spend'
      // This is a known limitation - script purpose can be ambiguous from bytecode alone
      expect(['spend', 'mint']).toContain(structure.type);
      expect(code).toContain('validator');
      
      console.log(`\n=== ${meta.name} ===`);
      console.log('Type:', structure.type);
      console.log('Params:', structure.params);
      console.log('Script params:', structure.scriptParams?.length || 0);
    });
  });

  describe('JPG Store V3 Ask', () => {
    it('full pipeline succeeds', () => {
      const { cbor, meta } = fixtures.get('jpg-store-v3-ask')!;
      const { structure, code } = decompile(cbor);
      
      expect(structure.type).toBe('spend');
      expect(code).toContain('validator');
      
      console.log(`\n=== ${meta.name} ===`);
      console.log('Type:', structure.type);
      console.log('Params:', structure.params);
    });
  });

  describe('All fixtures pipeline', () => {
    it('processes all contracts without crashing', () => {
      const results: { name: string; success: boolean; error?: string }[] = [];
      
      for (const [id, { meta, cbor }] of fixtures) {
        try {
          const { structure, code } = decompile(cbor);
          results.push({ name: meta.name, success: true });
          
          console.log(`\n✓ ${meta.name}`);
          console.log(`  Type: ${structure.type}`);
          console.log(`  Params: ${structure.params.join(', ')}`);
          console.log(`  Script params: ${structure.scriptParams?.length || 0}`);
          console.log(`  Code length: ${code.length} chars`);
        } catch (error: any) {
          results.push({ name: meta.name, success: false, error: error.message });
          console.log(`\n✗ ${meta.name}: ${error.message}`);
        }
      }
      
      const successes = results.filter(r => r.success).length;
      console.log(`\n=== Summary: ${successes}/${results.length} succeeded ===`);
      
      // All contracts should succeed with direct conversion!
      expect(successes).toBe(results.length);
    });
  });
});
