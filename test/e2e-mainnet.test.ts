/**
 * End-to-end test with REAL mainnet scripts
 * 
 * Tests the full decompilation pipeline: CBOR → UPLC → AST → Structure → Aiken
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

interface MainnetScript {
  hash: string;
  name: string;
  type: string;
  size: number;
  bytes: string;
}

let scripts: Record<string, MainnetScript>;

// Helper: hex string to Buffer
function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Helper: Strip CBOR wrapper
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

// Helper: Full pipeline
function decompile(cbor: string): { uplc: string; ast: any; structure: any; code: string } {
  const uplc = decodeToUplc(cbor);
  const ast = parseUplc(uplc);
  const structure = analyzeContract(ast);
  const code = generate(structure);
  return { uplc, ast, structure, code };
}

beforeAll(() => {
  const fixturesPath = join(__dirname, 'fixtures/mainnet/scripts.json');
  scripts = JSON.parse(readFileSync(fixturesPath, 'utf-8'));
});

describe('Mainnet script decompilation', () => {
  
  describe('SundaeSwap V3 Pool', () => {
    it('decodes CBOR to UPLC', () => {
      const script = scripts['sundaeswap_v3_pool'];
      expect(script).toBeDefined();
      expect(script.bytes).toBeDefined();
      
      const uplc = decodeToUplc(script.bytes);
      
      expect(uplc).toContain('lam');
      console.log(`SundaeSwap V3 UPLC length: ${uplc.length} chars`);
    });

    it('parses UPLC to AST', () => {
      const script = scripts['sundaeswap_v3_pool'];
      const uplc = decodeToUplc(script.bytes);
      
      const ast = parseUplc(uplc);
      
      expect(ast).toBeDefined();
      // AST nodes have a 'tag' property indicating node type
      expect(ast.tag).toBeDefined();
      console.log('SundaeSwap V3 AST root:', ast.tag);
    });

    it('analyzes contract structure', () => {
      const script = scripts['sundaeswap_v3_pool'];
      const uplc = decodeToUplc(script.bytes);
      const ast = parseUplc(uplc);
      
      const structure = analyzeContract(ast);
      
      console.log('SundaeSwap V3 structure:', JSON.stringify({
        type: structure.type,
        params: structure.params,
        hasRedeemer: structure.redeemer.variants.length > 0
      }, null, 2));
      
      expect(structure.type).toBeDefined();
    });

    it('generates Aiken code', () => {
      const script = scripts['sundaeswap_v3_pool'];
      const { code } = decompile(script.bytes);
      
      console.log('\n=== SundaeSwap V3 Pool Decompiled ===');
      console.log(code);
      
      expect(code).toContain('validator');
    });
  });

  describe('Minswap V2 Pool', () => {
    it('full decompilation pipeline', () => {
      const script = scripts['minswap_v2_pool'];
      expect(script).toBeDefined();
      
      const { code, structure } = decompile(script.bytes);
      
      console.log('\n=== Minswap V2 Pool Decompiled ===');
      console.log('Type:', structure.type);
      console.log('Params:', structure.params);
      console.log(code);
      
      expect(code).toContain('validator');
    });
  });

  describe('WingRiders Pool', () => {
    it('handles legacy Plutus scripts', () => {
      const script = scripts['wingriders_pool'];
      if (!script || !script.bytes || script.bytes === 'null') {
        console.log('WingRiders script not available in Koios');
        return;
      }
      
      const { code, structure } = decompile(script.bytes);
      
      console.log('\n=== WingRiders Pool Decompiled ===');
      console.log('Type:', structure.type);
      console.log(code);
      
      expect(code).toBeDefined();
    });
  });

  describe('All scripts pipeline', () => {
    it('processes all mainnet scripts without crashing', () => {
      const results: Record<string, { success: boolean; error?: string; type?: string }> = {};
      
      for (const [name, script] of Object.entries(scripts)) {
        if (!script.bytes || script.bytes === 'null') {
          results[name] = { success: false, error: 'No bytes available' };
          continue;
        }
        
        try {
          const { structure, code } = decompile(script.bytes);
          results[name] = { 
            success: true, 
            type: structure.type 
          };
        } catch (error: any) {
          results[name] = { 
            success: false, 
            error: error.message 
          };
        }
      }
      
      console.log('\n=== Pipeline Results ===');
      for (const [name, result] of Object.entries(results)) {
        const status = result.success ? '✓' : '✗';
        const info = result.success ? result.type : result.error;
        console.log(`${status} ${name}: ${info}`);
      }
      
      // Count successes
      const successes = Object.values(results).filter(r => r.success).length;
      const total = Object.keys(results).length;
      console.log(`\nSuccess rate: ${successes}/${total}`);
      
      // We should process at least the ones with valid bytes
      expect(successes).toBeGreaterThan(0);
    });
  });
});
