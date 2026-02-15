/**
 * Popular Contracts Test — Fixture-driven decompilation quality suite
 * 
 * Runs every fixture in test/fixtures/cbor/ through the full pipeline:
 *   CBOR → harmoniclabs decode → our AST → patterns → codegen → verify
 * 
 * Quality checks:
 *   1. Constant recovery: all UPLC constants must appear in Aiken output
 *   2. No ??? placeholders: codegen should never fall back to '???'
 *   3. No crashes: every fixture must process end-to-end
 * 
 * Fixtures fetched from Blockfrost: `bash test/fixtures/fetch-cbor.sh`
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { UPLCDecoder, showUPLC } from '@harmoniclabs/uplc';
import { convertFromHarmoniclabs } from '@uplc/parser';
import { analyzeContract } from '@uplc/patterns';
import { generate, verifyCode, checkBalancedDelimiters, checkValidatorStructure, checkSyntaxIssues } from '@uplc/codegen';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures', 'cbor');

// ─── Utilities ───────────────────────────────────────────────────

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

// ─── Discover fixtures ───────────────────────────────────────────

/** Load all fixture hashes from the fixtures directory */
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

// ─── Constant extraction from AST ───────────────────────────────

interface ExtractedConstants {
  bytestrings: string[];
  integers: string[];
}

/** Extract all non-trivial constants from the converted AST */
function extractConstants(ast: any): ExtractedConstants {
  const bytestrings: string[] = [];
  const integers: string[] = [];

  function extractValue(val: any) {
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
        extractData(val.value);
        break;
      case 'list':
        for (const arr of [val.value, val.items, val.list]) {
          if (Array.isArray(arr)) {
            for (const item of arr) {
              if (item && typeof item === 'object') {
                extractValue(item);
                extractData(item);
              }
            }
          }
        }
        break;
      case 'pair':
        if (val.fst) { extractValue(val.fst); extractData(val.fst); }
        if (val.snd) { extractValue(val.snd); extractData(val.snd); }
        break;
    }
  }

  function extractData(data: any) {
    if (!data) return;
    if (data.tag === 'bytes' || data.tag === 'B') {
      const raw = data.value;
      if (raw instanceof Uint8Array) {
        const hex = bufferToHex(raw);
        if (hex.length >= 8 && !bytestrings.includes(hex)) bytestrings.push(hex);
      } else if (typeof raw === 'string' && raw.length >= 8 && !bytestrings.includes(raw)) {
        bytestrings.push(raw);
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
      if (Array.isArray(fields)) for (const f of fields) extractData(f);
      return;
    }
    if (data.tag === 'list' || Array.isArray(data.value)) {
      const items = Array.isArray(data.value) ? data.value : (data.items || data.list || []);
      for (const item of items) extractData(item);
      return;
    }
    if (data.tag === 'map') {
      const entries = data.value || [];
      for (const entry of entries) {
        if (Array.isArray(entry)) { extractData(entry[0]); extractData(entry[1]); }
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
      case 'app': traverse(term.func); traverse(term.arg); break;
      case 'lam': traverse(term.body); break;
      case 'delay': case 'force': traverse(term.term); break;
      case 'con': if (term.value) extractValue(term.value); break;
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

// ─── Quality analysis ────────────────────────────────────────────

interface QualityReport {
  hash: string;
  type: string;
  code: string;
  codeLength: number;
  // Constants
  totalConstants: number;
  foundConstants: number;
  constantScore: number;
  missingConstants: string[];
  // Placeholders
  questionMarks: number; // count of '???' in output
  // Confidence
  confidence: string;
  // Structural
  undefinedFunctions: string[];
  placeholderScore: number;
}

/** Extract constants from raw harmoniclabs AST (catches data-embedded values the converter may not expose) */
function extractRawConstants(rawBody: any, bs: string[], ints: string[]) {
  if (!rawBody || typeof rawBody !== 'object') return;

  const termType = rawBody.constructor?.name;

  if (termType === 'UPLCConst') {
    extractRawValue(rawBody.value, bs, ints);
  } else if (termType === 'Application') {
    extractRawConstants(rawBody.funcTerm, bs, ints);
    extractRawConstants(rawBody.argTerm, bs, ints);
  } else if (termType === 'Lambda') {
    extractRawConstants(rawBody.body, bs, ints);
  } else if (termType === 'Delay') {
    extractRawConstants(rawBody.delayedTerm, bs, ints);
  } else if (termType === 'Force') {
    extractRawConstants(rawBody.termToForce, bs, ints);
  } else if (termType === 'Constr') {
    rawBody.terms?.forEach((t: any) => extractRawConstants(t, bs, ints));
  } else if (termType === 'Case') {
    extractRawConstants(rawBody.scrutinee, bs, ints);
    rawBody.branches?.forEach((t: any) => extractRawConstants(t, bs, ints));
  }
}

function extractRawValue(val: any, bs: string[], ints: string[]) {
  if (!val) return;
  if (val instanceof Uint8Array) {
    const hex = bufferToHex(val);
    if (hex.length >= 8 && !bs.includes(hex)) bs.push(hex);
    return;
  }
  if (val._bytes instanceof Uint8Array) {
    const hex = bufferToHex(val._bytes);
    if (hex.length >= 8 && !bs.includes(hex)) bs.push(hex);
    return;
  }
  if (typeof val === 'bigint') {
    const s = String(val);
    if (s !== '0' && s !== '1' && !ints.includes(s)) ints.push(s);
    return;
  }
  if (val.constr !== undefined && val.fields) {
    for (const f of val.fields) extractRawValue(f, bs, ints);
    return;
  }
  if (val.int !== undefined) {
    const s = String(val.int);
    if (s !== '0' && s !== '1' && !ints.includes(s)) ints.push(s);
    return;
  }
  if (val.bytes !== undefined) {
    if (val.bytes._bytes instanceof Uint8Array) {
      const hex = bufferToHex(val.bytes._bytes);
      if (hex.length >= 8 && !bs.includes(hex)) bs.push(hex);
    } else if (val.bytes instanceof Uint8Array) {
      const hex = bufferToHex(val.bytes);
      if (hex.length >= 8 && !bs.includes(hex)) bs.push(hex);
    }
    return;
  }
  if (Array.isArray(val)) {
    for (const item of val) extractRawValue(item, bs, ints);
    return;
  }
  if (val.list) {
    for (const item of val.list) extractRawValue(item, bs, ints);
  }
}

/** Full pipeline: CBOR → AST → structure → code → quality report */
function analyzeQuality(hash: string): QualityReport {
  const cbor = loadCbor(hash);
  const inner = stripCborWrapper(cbor);
  const buffer = hexToBuffer(inner);
  const program = UPLCDecoder.parse(buffer, 'flat');
  const ast = convertFromHarmoniclabs(program.body);
  const structure = analyzeContract(ast);
  const code = generate(structure);

  // Extract constants from both converted AST and raw harmoniclabs AST
  const constants = extractConstants(ast);
  extractRawConstants(program.body, constants.bytestrings, constants.integers);

  const verification = verifyCode(code, constants, []);

  // Count ??? placeholders — each one is a codegen gap
  const questionMarks = (code.match(/\?\?\?/g) || []).length;

  return {
    hash,
    type: structure.type,
    code,
    codeLength: code.length,
    totalConstants: verification.totalConstants,
    foundConstants: verification.foundConstants,
    constantScore: verification.totalConstants > 0
      ? verification.foundConstants / verification.totalConstants
      : 1,
    missingConstants: verification.missingConstants,
    questionMarks,
    confidence: verification.confidence,
    undefinedFunctions: verification.undefinedFunctions,
    placeholderScore: verification.placeholderScore,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

const fixtures = discoverFixtures();

// Cache pipeline results — each fixture runs the full pipeline once
const reportCache = new Map<string, QualityReport>();
function getReport(hash: string): QualityReport {
  let report = reportCache.get(hash);
  if (!report) {
    report = analyzeQuality(hash);
    reportCache.set(hash, report);
  }
  return report;
}

describe('Fixture Pipeline', () => {
  it('has fixture files', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const hash of fixtures) {
    const shortHash = hash.substring(0, 8);

    describe(shortHash, () => {
      it('decodes and decompiles without crashing', () => {
        const report = getReport(hash);
        expect(report.codeLength).toBeGreaterThan(0);
        expect(report.type).toBeDefined();
      });

      it('preserves all constants', () => {
        const report = getReport(hash);
        if (report.missingConstants.length > 0) {
          console.log(`  ${shortHash}: ${report.foundConstants}/${report.totalConstants} — missing: ${report.missingConstants.join(', ')}`);
        }
        expect(report.constantScore).toBe(1);
      });

      it('has balanced delimiters', () => {
        const report = getReport(hash);
        const check = checkBalancedDelimiters(report.code);
        if (!check.ok) {
          console.log(`  ${shortHash}: ${check.issues.join(', ')}`);
        }
        expect(check.ok, check.issues.join('; ')).toBe(true);
      });

      it('has valid validator structure', () => {
        const report = getReport(hash);
        const check = checkValidatorStructure(report.code, report.type);
        expect(check.ok, check.issues.join('; ')).toBe(true);
      });

      it('has no syntax issues', () => {
        const report = getReport(hash);
        const check = checkSyntaxIssues(report.code);
        if (!check.ok) {
          console.log(`  ${shortHash}: ${check.issues.join(', ')}`);
        }
        expect(check.ok, check.issues.join('; ')).toBe(true);
      });

      it('has no undefined functions', () => {
        const report = getReport(hash);
        expect(report.undefinedFunctions.length, `undefined: ${report.undefinedFunctions.join(', ')}`).toBe(0);
      });

      it('has no placeholder patterns', () => {
        const report = getReport(hash);
        expect(report.placeholderScore).toBe(1.0);
      });
    });
  }

  it('quality summary', () => {
    const reports = fixtures.map(getReport);

    console.log('\n=== Decompilation Quality ===');
    console.log(
      'Hash'.padEnd(12) +
      'Type'.padEnd(10) +
      'Code'.padEnd(8) +
      'Constants'.padEnd(16) +
      '???'.padEnd(6) +
      'Confidence'
    );
    console.log('-'.repeat(70));

    let totalQuestionMarks = 0;

    for (const r of reports) {
      const pct = (r.constantScore * 100).toFixed(0) + '%';
      const badge = r.confidence === 'high' ? '🟢' : r.confidence === 'medium' ? '🟡' : '🔴';
      totalQuestionMarks += r.questionMarks;
      console.log(
        r.hash.substring(0, 10).padEnd(12) +
        r.type.padEnd(10) +
        (r.codeLength + '').padEnd(8) +
        `${r.foundConstants}/${r.totalConstants} (${pct})`.padEnd(16) +
        (r.questionMarks + '').padEnd(6) +
        `${badge} ${r.confidence}`
      );
    }

    const perfect = reports.filter(r => r.constantScore === 1).length;
    const highConf = reports.filter(r => r.confidence === 'high').length;
    console.log(`\nConstants: ${perfect}/${reports.length} at 100%`);
    console.log(`Confidence: 🟢 ${highConf}  🟡 ${reports.filter(r => r.confidence === 'medium').length}  🔴 ${reports.filter(r => r.confidence === 'low').length}`);
    console.log(`Total ???: ${totalQuestionMarks} across all contracts`);

    expect(reports.length).toBe(fixtures.length);
  });
});
