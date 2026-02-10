/**
 * Test: Data-encoded bytestring constants are extracted
 * 
 * Contracts can embed bytestrings inside Data structures like:
 *   (con data Constr 0 [B #hash1, B #hash2])
 *   (con (list data) [B #hash1, B #hash2])
 * 
 * These must appear in the constants.bytestrings array.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { UPLCDecoder, showUPLC } from '@harmoniclabs/uplc';
import { convertFromHarmoniclabs } from '@uplc/parser';

// Reuse the extraction logic from analyze.ts
function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function extractConstantValues(val: any, bytestrings: string[], integers: string[]) {
  if (!val) return;
  switch (val.tag) {
    case 'integer':
      const intStr = (val.value ?? val).toString();
      if (!integers.includes(intStr)) integers.push(intStr);
      break;
    case 'bytestring': {
      const raw = val.value;
      if (raw instanceof Uint8Array) {
        const hex = bufferToHex(raw);
        if (hex.length >= 8 && !bytestrings.includes(hex)) bytestrings.push(hex);
      }
      break;
    }
    case 'data':
      extractDataValues(val.value, bytestrings, integers);
      break;
    case 'list':
      for (const arr of [val.value, val.items, val.list]) {
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (item && typeof item === 'object') {
              extractConstantValues(item, bytestrings, integers);
              extractDataValues(item, bytestrings, integers);
            }
          }
        }
      }
      break;
    case 'pair':
      if (val.fst) extractConstantValues(val.fst, bytestrings, integers);
      if (val.snd) extractConstantValues(val.snd, bytestrings, integers);
      break;
  }
}

function extractDataValues(data: any, bytestrings: string[], integers: string[]) {
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
    const intStr = (data.value ?? data).toString();
    if (!integers.includes(intStr)) integers.push(intStr);
    return;
  }
  if (data.tag === 'constr' || data.fields) {
    const fields = data.fields || data.value?.fields || [];
    if (Array.isArray(fields)) {
      for (const field of fields) extractDataValues(field, bytestrings, integers);
    }
    return;
  }
  if (data.tag === 'list' || Array.isArray(data.value)) {
    const items = Array.isArray(data.value) ? data.value : (data.list || []);
    for (const item of items) extractDataValues(item, bytestrings, integers);
    return;
  }
  if (data.tag === 'map') {
    const entries = data.value || [];
    for (const entry of entries) {
      if (Array.isArray(entry)) {
        extractDataValues(entry[0], bytestrings, integers);
        extractDataValues(entry[1], bytestrings, integers);
      }
    }
    return;
  }
  if (data instanceof Uint8Array) {
    const hex = bufferToHex(data);
    if (hex.length >= 8 && !bytestrings.includes(hex)) bytestrings.push(hex);
  }
}

// Raw AST extraction (harmoniclabs format)
function extractRawConstValues(val: any, bs: string[], ints: string[]) {
  if (!val) return;
  if (val instanceof Uint8Array) {
    const hex = bufferToHex(val);
    if (hex.length >= 8 && !bs.includes(hex)) bs.push(hex);
    return;
  }
  if (typeof val === 'bigint') {
    const s = val.toString();
    if (!ints.includes(s)) ints.push(s);
    return;
  }
  if (typeof val !== 'object') return;
  // ByteString wrapper
  if (val._bytes instanceof Uint8Array) {
    const hex = bufferToHex(val._bytes);
    if (hex.length >= 8 && !bs.includes(hex)) bs.push(hex);
    return;
  }
  // DataConstr
  if (Array.isArray(val.fields)) {
    for (const f of val.fields) extractRawConstValues(f, bs, ints);
  }
  // DataB
  if (val.bytes && val.bytes._bytes instanceof Uint8Array) {
    const hex = bufferToHex(val.bytes._bytes);
    if (hex.length >= 8 && !bs.includes(hex)) bs.push(hex);
  }
  // DataI
  if (val.int !== undefined) {
    const s = val.int.toString();
    if (!ints.includes(s)) ints.push(s);
  }
  // Plain array (list data)
  if (Array.isArray(val)) {
    for (const item of val) extractRawConstValues(item, bs, ints);
  }
  // DataList
  if (Array.isArray(val.list)) {
    for (const item of val.list) extractRawConstValues(item, bs, ints);
  }
}

// JPG Store V3 Ask — has Data-encoded bytestring constants
const JPG_ASK_FIXTURE = 'fixtures/mainnet/jpg-store-v3-ask.cbor';

describe('Data-encoded constant extraction', () => {
  // Check if we have the JPG Store fixture
  const fixturePath = join(__dirname, '..', JPG_ASK_FIXTURE);
  const hasFixture = existsSync(fixturePath);

  it('extracts bytestrings from our AST (convertFromHarmoniclabs)', () => {
    if (!hasFixture) {
      console.log('Skipping: no JPG Store fixture available');
      return;
    }

    const cbor = readFileSync(fixturePath, 'utf-8').trim();
    let innerHex = cbor;
    if (cbor.startsWith('59')) innerHex = cbor.slice(6);
    else if (cbor.startsWith('58')) innerHex = cbor.slice(4);
    else if (cbor.startsWith('5a')) innerHex = cbor.slice(10);
    
    const buffer = new Uint8Array(innerHex.length / 2);
    for (let i = 0; i < innerHex.length; i += 2) {
      buffer[i / 2] = parseInt(innerHex.substring(i, i + 2), 16);
    }
    
    const program = UPLCDecoder.parse(buffer, 'flat');
    const ast = convertFromHarmoniclabs(program.body);
    
    const bytestrings: string[] = [];
    const integers: string[] = [];
    
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
          traverse(term.term);
          break;
        case 'force':
          traverse(term.term);
          break;
        case 'con':
          if (term.value) extractConstantValues(term.value, bytestrings, integers);
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
    
    console.log(`Extracted ${bytestrings.length} bytestrings, ${integers.length} integers`);
    console.log('Bytestrings:', bytestrings);
    
    // Should find at least some bytestring constants
    expect(bytestrings.length).toBeGreaterThan(0);
  });

  it('extracts bytestrings from raw harmoniclabs AST', () => {
    if (!hasFixture) {
      console.log('Skipping: no JPG Store fixture available');
      return;
    }

    const cbor = readFileSync(fixturePath, 'utf-8').trim();
    let innerHex = cbor;
    if (cbor.startsWith('59')) innerHex = cbor.slice(6);
    else if (cbor.startsWith('58')) innerHex = cbor.slice(4);
    else if (cbor.startsWith('5a')) innerHex = cbor.slice(10);
    
    const buffer = new Uint8Array(innerHex.length / 2);
    for (let i = 0; i < innerHex.length; i += 2) {
      buffer[i / 2] = parseInt(innerHex.substring(i, i + 2), 16);
    }
    
    const program = UPLCDecoder.parse(buffer, 'flat');
    
    const bytestrings: string[] = [];
    const integers: string[] = [];
    
    function getType(term: any): string {
      if (!term) return 'null';
      if ('funcTerm' in term && 'argTerm' in term) return 'Application';
      if ('body' in term && !('scrutinee' in term) && !('terms' in term)) return 'Lambda';
      if ('delayedTerm' in term) return 'Delay';
      if ('termToForce' in term) return 'Force';
      if ('deBruijn' in term) return 'UPLCVar';
      if ('_tag' in term && !('value' in term)) return 'Builtin';
      if ('value' in term) return 'UPLCConst';
      if ('index' in term && 'terms' in term) return 'Constr';
      if ('scrutinee' in term && 'branches' in term) return 'Case';
      return 'unknown';
    }
    
    function traverseRaw(term: any) {
      if (!term) return;
      const type = getType(term);
      if (type === 'Application') {
        traverseRaw(term.funcTerm);
        traverseRaw(term.argTerm);
      } else if (type === 'Lambda') {
        traverseRaw(term.body);
      } else if (type === 'Delay') {
        traverseRaw(term.delayedTerm);
      } else if (type === 'Force') {
        traverseRaw(term.termToForce);
      } else if (type === 'UPLCConst') {
        extractRawConstValues(term.value, bytestrings, integers);
      } else if (type === 'Constr') {
        term.terms?.forEach(traverseRaw);
      } else if (type === 'Case') {
        traverseRaw(term.scrutinee);
        term.branches?.forEach(traverseRaw);
      }
    }
    
    traverseRaw(program._body);
    
    console.log(`Raw: ${bytestrings.length} bytestrings, ${integers.length} integers`);
    console.log('Bytestrings:', bytestrings);
    
    expect(bytestrings.length).toBeGreaterThan(0);
  });
});
