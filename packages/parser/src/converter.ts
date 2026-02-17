/**
 * Converter from @harmoniclabs/uplc AST to our AST format
 * 
 * This eliminates the text round-trip: CBOR → harmoniclabs AST → our AST (direct)
 * Instead of: CBOR → harmoniclabs AST → text → parse → our AST
 */

import type { UplcTerm, UplcValue, PlutusData } from './ast.js';

// Import from main @harmoniclabs/uplc package only
import {
  Application,
  Lambda,
  UPLCVar,
  UPLCConst,
  Builtin,
  Force,
  Delay,
  ErrorUPLC,
  Case,
  Constr,
  ConstTyTag,
  UPLCBuiltinTag,
  builtinTagToString,
} from '@harmoniclabs/uplc';

// Use 'any' for complex types that aren't re-exported
type UPLCTerm = any;
type ConstType = any;
type ConstValue = any;

/**
 * Generate variable names from de Bruijn indices
 * Uses a, b, c, ... z, a1, b1, ... pattern
 */
function indexToName(index: number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  if (index < 26) {
    return letters[index];
  }
  const suffix = Math.floor(index / 26);
  const letter = letters[index % 26];
  return `${letter}${suffix}`;
}

/**
 * Convert harmoniclabs ConstType to string representation
 */
function constTypeToString(type: ConstType): string {
  if (!Array.isArray(type) || type.length === 0) {
    return 'unknown';
  }
  
  if (type.length === 1) {
    switch (type[0]) {
      case ConstTyTag.int: return 'integer';
      case ConstTyTag.byteStr: return 'bytestring';
      case ConstTyTag.str: return 'string';
      case ConstTyTag.unit: return 'unit';
      case ConstTyTag.bool: return 'bool';
      case ConstTyTag.data: return 'data';
      case ConstTyTag.bls12_381_G1_element: return 'bls12_381_G1_element';
      case ConstTyTag.bls12_381_G2_element: return 'bls12_381_G2_element';
      case ConstTyTag.bls12_381_MlResult: return 'bls12_381_MlResult';
      default: return 'unknown';
    }
  }
  
  // Handle compound types (list, pair)
  if (type[0] === ConstTyTag.list) {
    const innerType = constTypeToString(type.slice(1));
    return `list(${innerType})`;
  }
  if (type[0] === ConstTyTag.pair) {
    // Pairs encode both type args in the remaining array
    return 'pair';
  }
  
  return 'unknown';
}

/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Convert harmoniclabs PlutusData to our format
 */
function convertData(data: any): PlutusData {
  if (data === null || data === undefined) {
    return { tag: 'int', value: 0n };
  }
  
  // DataConstr: has constr (or index) + fields
  const constrIndex = data.constr ?? data.index;
  if (constrIndex !== undefined && data.fields !== undefined) {
    return {
      tag: 'constr',
      index: Number(constrIndex),
      fields: data.fields.map(convertData),
    };
  }
  
  // DataMap: has map property which is array of k/v pairs
  if (data.map !== undefined) {
    return {
      tag: 'map',
      entries: data.map.map((e: any) => [convertData(e.k), convertData(e.v)] as [PlutusData, PlutusData]),
    };
  }
  
  // DataList: has list property
  if (data.list !== undefined) {
    return {
      tag: 'list',
      items: data.list.map(convertData),
    };
  }
  
  // DataI: has int property (bigint)
  if (data.int !== undefined) {
    return { tag: 'int', value: BigInt(data.int) };
  }
  
  // DataB: has bytes property (ByteString)
  if (data.bytes !== undefined) {
    const bytes = data.bytes;
    if (bytes instanceof Uint8Array) {
      return { tag: 'bytes', value: bytes };
    }
    // harmoniclabs ByteString class stores data in _bytes property
    if (bytes._bytes instanceof Uint8Array) {
      return { tag: 'bytes', value: bytes._bytes };
    }
    if (typeof bytes === 'string') {
      return { tag: 'bytes', value: hexToBytes(bytes) };
    }
    if (bytes.toBuffer) {
      return { tag: 'bytes', value: new Uint8Array(bytes.toBuffer()) };
    }
    // ByteString has toString that returns hex
    if (bytes.toString && typeof bytes.toString === 'function') {
      const str = bytes.toString();
      // Avoid [object Object] from default toString
      if (/^[0-9a-fA-F]*$/.test(str)) {
        return { tag: 'bytes', value: hexToBytes(str) };
      }
    }
    return { tag: 'bytes', value: new Uint8Array(0) };
  }
  
  // Fallback - try to detect type from structure
  if (typeof data === 'bigint') {
    return { tag: 'int', value: data };
  }
  if (typeof data === 'number') {
    return { tag: 'int', value: BigInt(data) };
  }
  
  // Fallback - shouldn't reach here with well-formed data
  return { tag: 'int', value: 0n };
}

/**
 * Convert harmoniclabs constant value to our format
 */
function convertConstValue(type: ConstType, value: ConstValue): UplcValue {
  const typeTag = Array.isArray(type) ? type[0] : type;
  
  switch (typeTag) {
    case ConstTyTag.int:
      return { tag: 'integer', value: BigInt(value) };
    
    case ConstTyTag.byteStr: {
      // ByteString can be string (hex), Uint8Array, or object with _bytes/toBuffer
      if (value instanceof Uint8Array) {
        return { tag: 'bytestring', value };
      }
      // harmoniclabs ByteString class stores data in _bytes property
      if (value && value._bytes instanceof Uint8Array) {
        return { tag: 'bytestring', value: value._bytes };
      }
      if (typeof value === 'string') {
        return { tag: 'bytestring', value: hexToBytes(value) };
      }
      if (value && value.toBuffer) {
        return { tag: 'bytestring', value: new Uint8Array(value.toBuffer()) };
      }
      if (value && value.toString) {
        const str = value.toString();
        if (/^[0-9a-fA-F]*$/.test(str)) {
          return { tag: 'bytestring', value: hexToBytes(str) };
        }
      }
      return { tag: 'bytestring', value: new Uint8Array(0) };
    }
    
    case ConstTyTag.str:
      return { tag: 'string', value: String(value) };
    
    case ConstTyTag.unit:
      return { tag: 'unit' };
    
    case ConstTyTag.bool:
      return { tag: 'bool', value: Boolean(value) };
    
    case ConstTyTag.data:
      return { tag: 'data', value: convertData(value) };
    
    case ConstTyTag.list: {
      const innerType = Array.isArray(type) ? type.slice(1) : [ConstTyTag.data];
      const items = Array.isArray(value) ? value : [];
      return {
        tag: 'list',
        elementType: constTypeToString(innerType),
        items: items.map(item => convertConstValue(innerType, item)),
      };
    }
    
    case ConstTyTag.pair: {
      const p = value;
      return {
        tag: 'pair',
        fstType: 'data',
        sndType: 'data',
        fst: convertConstValue([ConstTyTag.data], p?.fst ?? p?.[0]),
        snd: convertConstValue([ConstTyTag.data], p?.snd ?? p?.[1]),
      };
    }
    
    default:
      console.warn('Unknown constant type:', typeTag);
      return { tag: 'unit' };
  }
}

/**
 * Shared mutable counter for generating globally unique variable names.
 * Using a reference type ensures counter increments propagate across all
 * branches of the AST (Application, Case, Constr).
 */
interface Counter {
  value: number;
}

/**
 * Conversion context - tracks lambda bindings for de Bruijn → name resolution
 */
interface ConversionContext {
  /** Stack of bound variable names (most recent first) */
  bindings: string[];
  /** Shared counter for generating unique names */
  counter: Counter;
}

/**
 * Type guards for harmoniclabs AST nodes
 */
function isApplication(term: UPLCTerm): term is Application {
  return term && 'funcTerm' in term && 'argTerm' in term;
}

function isLambda(term: UPLCTerm): term is Lambda {
  return term && 'body' in term && !('constrTerm' in term) && !('delayedTerm' in term) && !('termToForce' in term);
}

function isUPLCVar(term: UPLCTerm): term is UPLCVar {
  return term && 'deBruijn' in term;
}

function isUPLCConst(term: UPLCTerm): term is UPLCConst {
  return term && 'type' in term && 'value' in term && Array.isArray(term.type);
}

function isBuiltin(term: UPLCTerm): term is Builtin {
  return term && 'tag' in term && typeof term.tag === 'number' && !('value' in term) && !('terms' in term);
}

function isForce(term: UPLCTerm): term is Force {
  return term && 'termToForce' in term;
}

function isDelay(term: UPLCTerm): term is Delay {
  return term && 'delayedTerm' in term;
}

function isCase(term: UPLCTerm): term is Case {
  return term && 'constrTerm' in term && 'continuations' in term;
}

function isConstr(term: UPLCTerm): term is Constr {
  return term && 'index' in term && 'terms' in term && !('continuations' in term);
}

function isError(term: UPLCTerm): boolean {
  return term instanceof ErrorUPLC || term?.constructor?.name === 'ErrorUPLC';
}

/**
 * Convert a harmoniclabs UPLC term to our AST format
 */
function convertTerm(term: UPLCTerm, ctx: ConversionContext): UplcTerm {
  // Application
  if (isApplication(term)) {
    return {
      tag: 'app',
      func: convertTerm(term.funcTerm, ctx),
      arg: convertTerm(term.argTerm, ctx),
    };
  }
  
  // Lambda - NOTE: harmoniclabs Lambda has no param name, just body
  if (isLambda(term)) {
    const paramName = indexToName(ctx.counter.value++);
    const newCtx: ConversionContext = {
      bindings: [paramName, ...ctx.bindings],
      counter: ctx.counter, // Same reference — mutations propagate to siblings
    };
    return {
      tag: 'lam',
      param: paramName,
      body: convertTerm(term.body, newCtx),
    };
  }
  
  // Variable (de Bruijn index)
  if (isUPLCVar(term)) {
    const index = Number(term.deBruijn);
    // harmoniclabs uses 0-based de Bruijn indices
    const name = ctx.bindings[index] ?? `?${index}`;
    return { tag: 'var', name };
  }
  
  // Constant
  if (isUPLCConst(term)) {
    return {
      tag: 'con',
      type: constTypeToString(term.type),
      value: convertConstValue(term.type, term.value),
    };
  }
  
  // Builtin
  if (isBuiltin(term)) {
    let name = builtinTagToString(term.tag) ?? `builtin_${term.tag}`;
    // Fix harmoniclabs tag rotation: they put hashToGroup before compress/uncompress,
    // but the Plutus spec (IntersectMBO/plutus) has compress, uncompress, hashToGroup.
    // Harmoniclabs: 58=hashToGroup, 59=compress, 60=uncompress (G1), 65-67 same for G2
    // Plutus spec:  58=compress, 59=uncompress, 60=hashToGroup (G1), 65-67 same for G2
    const blsFixMap: Record<string, string> = {
      'bls12_381_G1_hashToGroup': 'bls12_381_G1_compress',
      'bls12_381_G1_compress': 'bls12_381_G1_uncompress',
      'bls12_381_G1_uncompress': 'bls12_381_G1_hashToGroup',
      'bls12_381_G2_hashToGroup': 'bls12_381_G2_compress',
      'bls12_381_G2_compress': 'bls12_381_G2_uncompress',
      'bls12_381_G2_uncompress': 'bls12_381_G2_hashToGroup',
    };
    if (blsFixMap[name]) name = blsFixMap[name];
    return { tag: 'builtin', name };
  }
  
  // Force
  if (isForce(term)) {
    return {
      tag: 'force',
      term: convertTerm(term.termToForce, ctx),
    };
  }
  
  // Delay
  if (isDelay(term)) {
    return {
      tag: 'delay',
      term: convertTerm(term.delayedTerm, ctx),
    };
  }
  
  // Error
  if (isError(term)) {
    return { tag: 'error' };
  }
  
  // Case (Plutus V3)
  if (isCase(term)) {
    return {
      tag: 'case',
      scrutinee: convertTerm(term.constrTerm, ctx),
      branches: term.continuations.map(cont => convertTerm(cont, ctx)),
    };
  }
  
  // Constr (Plutus V3)
  if (isConstr(term)) {
    return {
      tag: 'constr',
      index: Number(term.index),
      args: term.terms.map(t => convertTerm(t, ctx)),
    };
  }
  
  // Fallback - log and return error
  console.error('Unknown UPLC term type:', term);
  console.error('Keys:', Object.keys(term));
  console.error('Constructor:', term?.constructor?.name);
  return { tag: 'error' };
}

/**
 * Convert a harmoniclabs UPLCTerm to our UplcTerm AST
 * 
 * @param term - The harmoniclabs AST term (from UPLCDecoder.parse().body)
 * @returns Our AST representation
 */
export function convertFromHarmoniclabs(term: UPLCTerm): UplcTerm {
  return convertTerm(term, { bindings: [], counter: { value: 0 } });
}
