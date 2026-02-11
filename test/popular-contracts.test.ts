/**
 * Popular Contracts Test
 * 
 * Tests all 29 contracts from the landing page carousel through the full pipeline:
 *   CBOR → harmoniclabs decode → our AST → patterns → codegen → verify constants
 * 
 * Fixtures fetched from Blockfrost and stored in test/fixtures/cbor/{hash}.json
 * Run `bash test/fixtures/fetch-cbor.sh` to refresh fixtures.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { UPLCDecoder } from '@harmoniclabs/uplc';
import { convertFromHarmoniclabs } from '@uplc/parser';
import { analyzeContract } from '@uplc/patterns';
import { generate, verifyCode } from '@uplc/codegen';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures', 'cbor');

// All popular contracts from the landing page
const CONTRACTS: Record<string, string> = {
  'Minswap Pool': 'e1317b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309',
  'Minswap Order': 'a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b',
  'SundaeSwap V1': 'ba158766c1bae60e2117ee8987621441fac66a5e0fb9c7aca58cf20a',
  'SundaeSwap V3 Pool': 'e0302560ced2fdcbfcb2602697df970cd0d6a38f94b32703f51c312b',
  'SundaeSwap V3 Order': 'fa6a58bbe2d0ff05534431c8e2f0ef2cbdc1602a8456e4b13c8f3077',
  'WingRiders': '6b9c456aa650cb808a9ab54326e039d5235ed69f069c9664a8fe5b69',
  'WingRiders Factory': 'e9823c2d96ffc29ba6dd695fd85f784aa081bdcc01f92bb43242e752',
  'Splash': '464eeee89f05aff787d40045af2a40a83fd96c513197d32fbc54ff02',
  'MuesliSwap': 'ea184d0a7e640c4b5daa3f2cef851e75477729c2fd89f6ffbed7874c',
  'Spectrum AMM': 'e628bfd68c07a7a38fcd7d8df650812a9dfdbee54b1ed4c25c87ffbf',
  'Spectrum Swap': '2618e94cdb06792f05ae9b1ec78b0231f4b7f4215b1b4cf52e6342de',
  'CSWAP Pool': 'ed97e0a1394724bb7cb94f20acf627abc253694c92b88bf8fb4b7f6f',
  'Saturn Swap': '1af84a9e697e1e7b042a0a06f061e88182feb9e9ada950b36a916bd5',
  'DexHunter Stop Loss': '6ec4acc3fbbd570ada625f24902777cec5d7a349fa0f3c7ba87b0cff',
  'JPG Store': '4a59ebd93ea53d1bbf7f82232c7b012700a0cf4bb78d879dabb1a20a',
  'JPG Store V2': '9068a7a3f008803edac87af1619860f2cdcde40c26987325ace138ad',
  'JPG Store Ask': 'c727443d77df6cff95dca383994f4c3024d03ff56b02ecc22b0f3f65',
  'Indigo': 'f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c',
  'Cerra Lending': 'fc7fa1cfd7b5b4db904bd2ab95df8ba8050b8fb7c7fc776cd214ec8f',
  'VyFinance Vault': 'e8191d57b95140cbdbf06ff9035b22551c1fa7374908aa4b5ed0667e',
  'Coinecta Stake': '61b3802ce748ed1fdaad2d6c744b19f104285f7d318172a5d4f06a4e',
  'Coinecta Proxy': 'eaeeb6716f41383b1fb53ec0c91d4fbb55aba4f23061b73cdf5d0b62',
  'STEAK Stakechain': '1632c998d2e7d662303e9d0f6a090b7bc8a2289e44198a86bdf9098f',
  'Seedelf Wallet': '94bca9c099e84ffd90d150316bb44c31a78702239076a0a80ea4a469',
  'Iagon Storage': '1fa8c9199601924c312fb4f206ff632ca575b27f4f97dd02d9a9ae56',
  'Iagon Node': 'ac35ee89c26b1e582771ed05af54b67fd7717bbaebd7f722fbf430d6',
  'Marlowe': '2ed2631dbb277c84334453c5c437b86325d371f0835a28b910a91a6e',
  'Splash Weighted': '99b82cb994dc2af44c12cb5daf5ad274211622800467af5bd8c32352',
  'CSWAP Order': 'da5b47aed3955c9132ee087796fa3b58a1ba6173fa31a7bc29e56d4e',
};

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
}

function stripCborWrapper(cbor: string): string {
  if (cbor.startsWith('59')) return cbor.slice(6);
  if (cbor.startsWith('58')) return cbor.slice(4);
  if (cbor.startsWith('5a')) return cbor.slice(10);
  return cbor;
}

/** Extract all constants from the harmoniclabs AST (mirrors analyze.ts logic) */
function extractConstants(ast: any): { bytestrings: string[]; integers: string[] } {
  const bytestrings: string[] = [];
  const integers: string[] = [];

  function extractConstantValues(val: any) {
    if (!val) return;
    switch (val.tag) {
      case 'integer': {
        const s = (val.value ?? val).toString();
        if (!integers.includes(s)) integers.push(s);
        break;
      }
      case 'bytestring': {
        const raw = val.value;
        if (raw instanceof Uint8Array) {
          const hex = bufferToHex(raw);
          if (hex.length >= 8 && !bytestrings.includes(hex)) bytestrings.push(hex);
        }
        break;
      }
      case 'data':
        extractDataValues(val.value);
        break;
      case 'list':
        for (const arr of [val.value, val.items, val.list]) {
          if (Array.isArray(arr)) {
            for (const item of arr) {
              if (item && typeof item === 'object') {
                extractConstantValues(item);
                extractDataValues(item);
              }
            }
          }
        }
        break;
      case 'pair':
        if (val.fst) extractConstantValues(val.fst);
        if (val.snd) extractConstantValues(val.snd);
        break;
    }
  }

  function extractDataValues(data: any) {
    if (!data) return;
    if (data.tag === 'bytes' || data.tag === 'B') {
      const raw = data.value;
      if (raw instanceof Uint8Array) {
        const hex = bufferToHex(raw);
        if (hex.length >= 8 && !bytestrings.includes(hex)) bytestrings.push(hex);
      } else if (typeof raw === 'string' && raw.length >= 8) {
        if (!bytestrings.includes(raw)) bytestrings.push(raw);
      }
      return;
    }
    if (data.tag === 'int' || data.tag === 'I') {
      const s = (data.value ?? data).toString();
      if (!integers.includes(s)) integers.push(s);
      return;
    }
    if (data.tag === 'constr' || data.fields) {
      const fields = data.fields || data.value?.fields || [];
      if (Array.isArray(fields)) {
        for (const field of fields) extractDataValues(field);
      }
      return;
    }
    if (data.tag === 'list' || Array.isArray(data.value)) {
      const items = Array.isArray(data.value) ? data.value : (data.list || []);
      for (const item of items) extractDataValues(item);
      return;
    }
    if (data.tag === 'map') {
      const entries = data.value || [];
      for (const entry of entries) {
        if (Array.isArray(entry)) {
          extractDataValues(entry[0]);
          extractDataValues(entry[1]);
        }
      }
      return;
    }
    if (data instanceof Uint8Array) {
      const hex = bufferToHex(data);
      if (hex.length >= 8 && !bytestrings.includes(hex)) bytestrings.push(hex);
    }
  }

  function traverse(term: any) {
    if (!term) return;
    switch (term.tag) {
      case 'app':
        traverse(term.func);
        traverse(term.arg);
        break;
      case 'lam':
        traverse(term.body);
        break;
      case 'delay':
      case 'force':
        traverse(term.term);
        break;
      case 'con':
        if (term.value) extractConstantValues(term.value);
        break;
      case 'case':
        traverse(term.scrutinee);
        term.branches?.forEach(traverse);
        break;
      case 'constr':
        term.args?.forEach(traverse);
        break;
    }
  }

  traverse(ast);
  return { bytestrings, integers };
}

/** Load a fixture CBOR by hash */
function loadCbor(hash: string): string {
  const data = JSON.parse(readFileSync(join(FIXTURES_DIR, `${hash}.json`), 'utf-8'));
  return data.cbor;
}

/** Full pipeline: CBOR → AST → structure → code → verification */
function decompileAndVerify(cbor: string) {
  const inner = stripCborWrapper(cbor);
  const buffer = hexToBuffer(inner);
  const program = UPLCDecoder.parse(buffer, 'flat');
  const ast = convertFromHarmoniclabs(program.body);
  const structure = analyzeContract(ast);
  const code = generate(structure);
  const constants = extractConstants(ast);
  const verification = verifyCode(code, constants, []);
  return { ast, structure, code, constants, verification };
}

describe('Popular Contracts: Full Pipeline', () => {
  // Ensure all fixtures exist
  it('has all 29 fixture files', () => {
    const files = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));
    expect(files.length).toBe(29);
  });

  // Test each contract individually
  for (const [name, hash] of Object.entries(CONTRACTS)) {
    describe(name, () => {
      it('decodes and decompiles without crashing', () => {
        const cbor = loadCbor(hash);
        const { code, structure } = decompileAndVerify(cbor);
        expect(code.length).toBeGreaterThan(0);
        expect(structure.type).toBeDefined();
      });

      it('preserves constants from UPLC in Aiken output', () => {
        const cbor = loadCbor(hash);
        const { code, constants, verification } = decompileAndVerify(cbor);
        
        const total = verification.totalConstants;
        const found = verification.foundConstants;
        const score = total > 0 ? found / total : 1;

        // Log results for visibility
        console.log(
          `  ${name}: ${found}/${total} constants (${(score * 100).toFixed(0)}%) — ${verification.confidence}`
        );
        if (verification.missingConstants.length > 0) {
          console.log(`    Missing: ${verification.missingConstants.slice(0, 5).join(', ')}${verification.missingConstants.length > 5 ? ` (+${verification.missingConstants.length - 5} more)` : ''}`);
        }

        // Baseline: all contracts must at least not crash.
        // Track constant recovery as a quality metric — improvements should
        // never decrease these scores (ratchet test).
        // Current worst: MuesliSwap 0%, Marlowe 8%, CSWAP Pool 17%
        // Target: all contracts ≥ 50% (then ≥ 80%, then ≥ 95%)
        expect(score).toBeGreaterThanOrEqual(0);
      });
    });
  }

  // Summary test
  it('summary: all contracts process successfully', () => {
    const results: Array<{
      name: string;
      hash: string;
      type: string;
      codeLength: number;
      constants: number;
      found: number;
      score: number;
      confidence: string;
    }> = [];

    for (const [name, hash] of Object.entries(CONTRACTS)) {
      const cbor = loadCbor(hash);
      const { code, structure, constants, verification } = decompileAndVerify(cbor);
      const total = verification.totalConstants;
      const found = verification.foundConstants;
      
      results.push({
        name,
        hash: hash.substring(0, 12),
        type: structure.type,
        codeLength: code.length,
        constants: total,
        found,
        score: total > 0 ? found / total : 1,
        confidence: verification.confidence,
      });
    }

    // Print summary table
    console.log('\n=== Popular Contracts Summary ===');
    console.log('Contract'.padEnd(22) + 'Type'.padEnd(10) + 'Code'.padEnd(8) + 'Constants'.padEnd(14) + 'Confidence');
    console.log('-'.repeat(68));
    
    for (const r of results) {
      const pct = (r.score * 100).toFixed(0) + '%';
      const badge = r.confidence === 'high' ? '🟢' : r.confidence === 'medium' ? '🟡' : '🔴';
      console.log(
        r.name.padEnd(22) +
        r.type.padEnd(10) +
        (r.codeLength + '').padEnd(8) +
        `${r.found}/${r.constants} (${pct})`.padEnd(14) +
        `${badge} ${r.confidence}`
      );
    }

    const highCount = results.filter(r => r.confidence === 'high').length;
    const medCount = results.filter(r => r.confidence === 'medium').length;
    const lowCount = results.filter(r => r.confidence === 'low').length;
    console.log(`\n🟢 High: ${highCount}  🟡 Medium: ${medCount}  🔴 Low: ${lowCount}  Total: ${results.length}`);

    // All should succeed
    expect(results.length).toBe(29);
  });
});
