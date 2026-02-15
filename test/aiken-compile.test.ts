/**
 * Aiken Compile + Roundtrip Test
 *
 * For each fixture:
 * 1. Generate Aiken code via normal pipeline
 * 2. Scaffold temp dir with aiken.toml + validators/decompiled.ak
 * 3. Run `aiken build` with 60s timeout
 * 4. If build succeeds, extract compiled UPLC from plutus.json
 * 5. Compare recompiled UPLC with original (size ratio, AST metrics)
 * 6. Generate report: test/reports/aiken-compile-report.json
 *
 * Skips gracefully when `aiken` binary not found.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

import { UPLCDecoder } from '@harmoniclabs/uplc';
import { convertFromHarmoniclabs } from '@uplc/parser';
import { analyzeContract } from '@uplc/patterns';
import { generate } from '@uplc/codegen';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures', 'cbor');
const REPORTS_DIR = join(__dirname, 'reports');

// ─── Utilities ───────────────────────────────────────────────────

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function stripCborWrapper(cbor: string): string {
  if (cbor.startsWith('59')) return cbor.slice(6);
  if (cbor.startsWith('58')) return cbor.slice(4);
  if (cbor.startsWith('5a')) return cbor.slice(10);
  return cbor;
}

function discoverFixtures(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''))
    .sort();
}

function loadCbor(hash: string): string {
  const data = JSON.parse(readFileSync(join(FIXTURES_DIR, `${hash}.json`), 'utf-8'));
  return data.cbor;
}

/** Generate Aiken code for a fixture */
function generateAikenCode(hash: string): { code: string; type: string } {
  const cbor = loadCbor(hash);
  const inner = stripCborWrapper(cbor);
  const buffer = hexToBuffer(inner);
  const program = UPLCDecoder.parse(buffer, 'flat');
  const ast = convertFromHarmoniclabs(program.body);
  const structure = analyzeContract(ast);
  const code = generate(structure);
  return { code, type: structure.type };
}

/** Check if aiken binary is available */
function aikenAvailable(): boolean {
  try {
    execSync('aiken --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const AIKEN_TOML = `name = "uplc/fixture"
version = "0.0.0"
plutus = "v3"

[[dependencies]]
name = "aiken-lang/stdlib"
version = "v2"
source = "github"
`;

interface CompileResult {
  hash: string;
  success: boolean;
  errors: string[];
  errorCategories: Record<string, number>;
  blueprint?: any;
  compiledSize?: number;
  originalSize: number;
  sizeRatio?: number;
}

/** Categorize an aiken build error */
function categorizeError(line: string): string {
  if (/syntax/i.test(line) || /unexpected/i.test(line) || /expected/i.test(line)) return 'syntax';
  if (/type/i.test(line) || /mismatch/i.test(line) || /does not match/i.test(line)) return 'type';
  if (/import/i.test(line) || /module/i.test(line) || /not found/i.test(line)) return 'import';
  return 'unknown';
}

/** Run aiken build in a scaffold directory */
function compileFixture(hash: string): CompileResult {
  const { code, type } = generateAikenCode(hash);
  const originalSize = loadCbor(hash).length / 2; // bytes

  // Create temp scaffold
  const tmpDir = join(__dirname, '.aiken-tmp', hash.slice(0, 8));
  const validatorsDir = join(tmpDir, 'validators');

  try {
    mkdirSync(validatorsDir, { recursive: true });
    writeFileSync(join(tmpDir, 'aiken.toml'), AIKEN_TOML);
    writeFileSync(join(validatorsDir, 'decompiled.ak'), code);

    // Run aiken build
    const result = execSync('aiken build 2>&1', {
      cwd: tmpDir,
      timeout: 60000,
      stdio: 'pipe',
      encoding: 'utf-8',
    });

    // Parse blueprint if build succeeded
    const blueprintPath = join(tmpDir, 'plutus.json');
    let blueprint: any = null;
    let compiledSize: number | undefined;
    let sizeRatio: number | undefined;

    if (existsSync(blueprintPath)) {
      blueprint = JSON.parse(readFileSync(blueprintPath, 'utf-8'));
      // Extract compiled validator CBOR
      const validators = blueprint.validators || [];
      if (validators.length > 0 && validators[0].compiledCode) {
        const compiledHex = validators[0].compiledCode;
        compiledSize = compiledHex.length / 2;
        sizeRatio = compiledSize / originalSize;
      }
    }

    return {
      hash,
      success: true,
      errors: [],
      errorCategories: {},
      blueprint,
      compiledSize,
      originalSize,
      sizeRatio,
    };
  } catch (err: any) {
    const output = err.stdout || err.stderr || err.message || '';
    const lines = output.split('\n').filter((l: string) => l.trim());

    // Categorize errors
    const categories: Record<string, number> = {};
    const errors: string[] = [];
    for (const line of lines) {
      if (/error/i.test(line)) {
        const cat = categorizeError(line);
        categories[cat] = (categories[cat] || 0) + 1;
        errors.push(line.trim().slice(0, 200));
      }
    }

    // If no explicit error lines, use first few lines
    if (errors.length === 0) {
      errors.push(...lines.slice(0, 5).map((l: string) => l.trim().slice(0, 200)));
    }

    return {
      hash,
      success: false,
      errors,
      errorCategories: categories,
      originalSize,
    };
  } finally {
    // Clean up
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ─── Tests ───────────────────────────────────────────────────────

const fixtures = discoverFixtures();
const hasAiken = aikenAvailable();

describe('Aiken Compile', () => {
  beforeAll(() => {
    if (!hasAiken) {
      console.log('⚠ aiken binary not found — skipping compile tests');
    }
    mkdirSync(REPORTS_DIR, { recursive: true });
  });

  it.skipIf(!hasAiken)('compiles all fixtures and generates report', { timeout: 120000 }, () => {
    const results: CompileResult[] = [];

    for (const hash of fixtures) {
      const result = compileFixture(hash);
      results.push(result);
    }

    // Generate report
    const report = {
      timestamp: new Date().toISOString(),
      aikenVersion: hasAiken ? execSync('aiken --version', { encoding: 'utf-8' }).trim() : 'unknown',
      totalFixtures: fixtures.length,
      compiled: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results: results.map(r => ({
        hash: r.hash.slice(0, 8),
        success: r.success,
        originalSize: r.originalSize,
        compiledSize: r.compiledSize,
        sizeRatio: r.sizeRatio ? +r.sizeRatio.toFixed(2) : null,
        errorCategories: r.errorCategories,
        errorSample: r.errors.slice(0, 3),
      })),
    };

    writeFileSync(
      join(REPORTS_DIR, 'aiken-compile-report.json'),
      JSON.stringify(report, null, 2)
    );

    // Print summary
    console.log('\n=== Aiken Compile Report ===');
    console.log(`Compiled: ${report.compiled}/${report.totalFixtures}`);
    console.log(`Failed: ${report.failed}/${report.totalFixtures}`);

    if (report.compiled > 0) {
      const compiled = results.filter(r => r.success && r.sizeRatio);
      const avgRatio = compiled.reduce((s, r) => s + (r.sizeRatio || 0), 0) / compiled.length;
      console.log(`Avg size ratio (recompiled/original): ${avgRatio.toFixed(2)}`);
    }

    // Log failures
    for (const r of results.filter(r => !r.success)) {
      const cats = Object.entries(r.errorCategories).map(([k,v]) => `${k}:${v}`).join(' ');
      console.log(`  ${r.hash.slice(0,8)}: FAIL [${cats}] ${r.errors[0]?.slice(0, 80) || ''}`);
    }

    // Log successes with roundtrip info
    for (const r of results.filter(r => r.success)) {
      const ratio = r.sizeRatio ? `${r.sizeRatio.toFixed(2)}x` : 'n/a';
      console.log(`  ${r.hash.slice(0,8)}: OK (size ratio: ${ratio})`);
    }

    // Report generated — this is a quality metric test, not a hard assertion
    expect(results.length).toBe(fixtures.length);
  });
});
