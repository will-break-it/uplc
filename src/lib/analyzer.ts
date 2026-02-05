// UPLC Analyzer - Real UPLC decoding using @harmoniclabs/uplc

import { UPLCDecoder, builtinTagToString } from '@harmoniclabs/uplc';
import { decode as cborDecode } from 'cbor-x';

export interface ScriptInfo {
  scriptHash: string;
  type: string;
  size: number;
  bytes: string;
  creationTxHash?: string;
}

export interface DecodedDatum {
  raw: string;
  txHash: string;
  outputIndex: number;
  decoded: any;
  prettyPrinted: string;
}

export interface DecodedRedeemer {
  raw: string;
  txHash: string;
  purpose: string;
  decoded: any;
  prettyPrinted: string;
  unitMem: number;
  unitSteps: number;
  fee: string;
}

export interface AnalysisResult {
  scriptInfo: ScriptInfo;
  builtins: Record<string, number>;
  errorMessages: string[];
  constants: {
    bytestrings: string[];
    integers: string[];
  };
  classification: string;
  stats: {
    totalBuiltins: number;
    uniqueBuiltins: number;
    lambdaCount: number;
    forceCount: number;
    delayCount: number;
    applicationCount: number;
  };
  version: string;
  uplcPreview: string;
  datums: DecodedDatum[];
  redeemers: DecodedRedeemer[];
}

// Helper: Convert hex bytes to readable text (for protocol detection)
function hexToText(hex: string): string {
  let result = '';
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substring(i, i + 2), 16);
    if (byte >= 32 && byte < 127) {
      result += String.fromCharCode(byte);
    } else {
      result += '.';
    }
  }
  return result;
}

export async function fetchScriptInfo(scriptHash: string): Promise<ScriptInfo> {
  // Use local proxy to avoid CORS issues
  const apiUrl = typeof window !== 'undefined' && window.location.hostname !== 'localhost'
    ? '/api/koios'  // Cloudflare Function proxy
    : 'https://api.koios.rest/api/v1/script_info';  // Direct for local dev
    
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ _script_hashes: [scriptHash] }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch script: ${response.statusText}`);
  }

  const data = await response.json();
  if (!data || data.length === 0) {
    throw new Error('Script not found on chain');
  }

  const script = data[0];
  return {
    scriptHash: script.script_hash,
    type: script.type,
    size: script.size,
    bytes: script.bytes,
    creationTxHash: script.creation_tx_hash,
  };
}

// Pretty print decoded CBOR data (Plutus Data format)
function prettyPrintPlutusData(data: any, indent: number = 0): string {
  const pad = '  '.repeat(indent);
  
  if (data === null || data === undefined) {
    return `${pad}null`;
  }
  
  // Handle Constr (constructor) - represented as tagged CBOR
  if (data instanceof Map) {
    const entries = Array.from(data.entries());
    if (entries.length === 0) {
      return `${pad}Map {}`;
    }
    const items = entries.map(([k, v]) => {
      const keyStr = typeof k === 'object' ? JSON.stringify(k) : String(k);
      return `${pad}  ${keyStr}: ${prettyPrintPlutusData(v, indent + 1).trim()}`;
    });
    return `${pad}Map {\n${items.join(',\n')}\n${pad}}`;
  }
  
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return `${pad}[]`;
    }
    // Check if this looks like a Constr (first element is number, second is array)
    if (data.length === 2 && typeof data[0] === 'number' && Array.isArray(data[1])) {
      const fields = data[1].map((f: any) => prettyPrintPlutusData(f, indent + 1));
      if (fields.length === 0) {
        return `${pad}Constr ${data[0]} []`;
      }
      return `${pad}Constr ${data[0]} [\n${fields.join(',\n')}\n${pad}]`;
    }
    const items = data.map((item: any) => prettyPrintPlutusData(item, indent + 1));
    return `${pad}[\n${items.join(',\n')}\n${pad}]`;
  }
  
  if (data instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(data))) {
    const hex = Array.from(data as Uint8Array).map(b => b.toString(16).padStart(2, '0')).join('');
    if (hex.length <= 64) {
      return `${pad}bytes: ${hex}`;
    }
    return `${pad}bytes: ${hex.slice(0, 60)}... (${hex.length / 2} bytes)`;
  }
  
  if (typeof data === 'bigint') {
    return `${pad}int: ${data.toString()}`;
  }
  
  if (typeof data === 'number') {
    return `${pad}int: ${data}`;
  }
  
  if (typeof data === 'string') {
    return `${pad}text: "${data}"`;
  }
  
  if (typeof data === 'boolean') {
    return `${pad}bool: ${data}`;
  }
  
  // Handle CBOR tagged values (like Constr)
  if (data && typeof data === 'object' && 'tag' in data && 'value' in data) {
    const tag = data.tag;
    const value = data.value;
    
    // Plutus Constr tags: 121-127 for constructors 0-6, 1280+ for higher
    if (tag >= 121 && tag <= 127) {
      const constrIndex = tag - 121;
      if (Array.isArray(value)) {
        const fields = value.map((f: any) => prettyPrintPlutusData(f, indent + 1));
        if (fields.length === 0) {
          return `${pad}Constr ${constrIndex} []`;
        }
        return `${pad}Constr ${constrIndex} [\n${fields.join(',\n')}\n${pad}]`;
      }
      return `${pad}Constr ${constrIndex} ${prettyPrintPlutusData(value, indent)}`;
    }
    if (tag >= 1280 && tag <= 1400) {
      const constrIndex = tag - 1280 + 7;
      if (Array.isArray(value)) {
        const fields = value.map((f: any) => prettyPrintPlutusData(f, indent + 1));
        if (fields.length === 0) {
          return `${pad}Constr ${constrIndex} []`;
        }
        return `${pad}Constr ${constrIndex} [\n${fields.join(',\n')}\n${pad}]`;
      }
      return `${pad}Constr ${constrIndex} ${prettyPrintPlutusData(value, indent)}`;
    }
    
    return `${pad}Tag(${tag}) ${prettyPrintPlutusData(value, indent)}`;
  }
  
  // Fallback for other objects
  try {
    return `${pad}${JSON.stringify(data, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2)}`;
  } catch {
    return `${pad}[Object]`;
  }
}

// Decode CBOR hex string
function decodeCborHex(hex: string): { decoded: any; prettyPrinted: string } {
  try {
    const buffer = hexToBuffer(hex);
    const decoded = cborDecode(buffer);
    const prettyPrinted = prettyPrintPlutusData(decoded);
    return { decoded, prettyPrinted };
  } catch (e: any) {
    return { 
      decoded: null, 
      prettyPrinted: `Error decoding: ${e.message}` 
    };
  }
}

// Fetch recent datums from script UTXOs
export async function fetchScriptDatums(scriptHash: string, limit: number = 10): Promise<DecodedDatum[]> {
  const isProduction = typeof window !== 'undefined' && window.location.hostname !== 'localhost';
  const apiUrl = isProduction
    ? '/api/script_utxos'
    : 'https://api.koios.rest/api/v1/script_utxos';
  
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _script_hash: scriptHash, _extended: true }),
    });
    
    if (!response.ok) {
      console.warn('Failed to fetch UTXOs:', response.statusText);
      return [];
    }
    
    const data = await response.json();
    if (!data || !Array.isArray(data)) {
      return [];
    }
    
    const datums: DecodedDatum[] = [];
    
    for (const utxo of data.slice(0, limit)) {
      // Check for inline datum
      if (utxo.inline_datum && utxo.inline_datum.bytes) {
        const { decoded, prettyPrinted } = decodeCborHex(utxo.inline_datum.bytes);
        datums.push({
          raw: utxo.inline_datum.bytes,
          txHash: utxo.tx_hash,
          outputIndex: utxo.tx_index,
          decoded,
          prettyPrinted,
        });
      }
      // Check for datum hash reference
      else if (utxo.datum_hash) {
        // We'd need another API call to resolve datum by hash
        // For now, just note the hash
        datums.push({
          raw: '',
          txHash: utxo.tx_hash,
          outputIndex: utxo.tx_index,
          decoded: { datumHash: utxo.datum_hash },
          prettyPrinted: `Datum hash: ${utxo.datum_hash}\n(datum not inline, would need separate lookup)`,
        });
      }
    }
    
    return datums;
  } catch (e) {
    console.warn('Error fetching datums:', e);
    return [];
  }
}

// Fetch recent redeemers
export async function fetchScriptRedeemers(scriptHash: string, limit: number = 10): Promise<DecodedRedeemer[]> {
  const isProduction = typeof window !== 'undefined' && window.location.hostname !== 'localhost';
  const apiUrl = isProduction
    ? '/api/script_redeemers'
    : 'https://api.koios.rest/api/v1/script_redeemers';
  
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _script_hash: scriptHash }),
    });
    
    if (!response.ok) {
      console.warn('Failed to fetch redeemers:', response.statusText);
      return [];
    }
    
    const data = await response.json();
    if (!data || !Array.isArray(data)) {
      return [];
    }
    
    const redeemers: DecodedRedeemer[] = [];
    
    for (const item of data.slice(0, limit)) {
      if (item.redeemer && item.redeemer.datum && item.redeemer.datum.bytes) {
        const { decoded, prettyPrinted } = decodeCborHex(item.redeemer.datum.bytes);
        redeemers.push({
          raw: item.redeemer.datum.bytes,
          txHash: item.tx_hash,
          purpose: item.redeemer.purpose || 'spend',
          decoded,
          prettyPrinted,
          unitMem: item.redeemer.unit_mem || 0,
          unitSteps: item.redeemer.unit_steps || 0,
          fee: item.redeemer.fee || '0',
        });
      }
    }
    
    return redeemers;
  } catch (e) {
    console.warn('Error fetching redeemers:', e);
    return [];
  }
}

// Real UPLC decoding using @harmoniclabs/uplc
export function decodeUPLC(bytes: string): {
  program: any;
  version: string;
  builtins: Record<string, number>;
  constants: { bytestrings: string[]; integers: string[] };
  stats: {
    lambdaCount: number;
    forceCount: number;
    delayCount: number;
    applicationCount: number;
  };
  prettyPrint: string;
} {
  // Strip CBOR header if present (59XXXX = 2-byte length bytestring)
  let innerHex = bytes;
  if (bytes.startsWith('59') || bytes.startsWith('58') || bytes.startsWith('5a')) {
    // CBOR byte string header
    if (bytes.startsWith('59')) {
      innerHex = bytes.slice(6); // 59 + 2-byte length
    } else if (bytes.startsWith('58')) {
      innerHex = bytes.slice(4); // 58 + 1-byte length
    } else if (bytes.startsWith('5a')) {
      innerHex = bytes.slice(10); // 5a + 4-byte length
    }
  }
  
  const buffer = hexToBuffer(innerHex);
  const program = UPLCDecoder.parse(buffer, "flat");
  
  const version = `${program._version._major}.${program._version._minor}.${program._version._patch}`;
  
  // Extract builtins, constants, and stats from AST
  const builtins: Record<string, number> = {};
  const bytestrings: string[] = [];
  const integers: string[] = [];
  let lambdaCount = 0;
  let forceCount = 0;
  let delayCount = 0;
  let applicationCount = 0;
  
  // Detect term type by properties (survives minification)
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

  function traverse(term: any) {
    if (!term) return;
    
    const termType = getType(term);
    
    switch (termType) {
      case 'Application':
        applicationCount++;
        traverse(term.funcTerm);
        traverse(term.argTerm);
        break;
      case 'Lambda':
        lambdaCount++;
        traverse(term.body);
        break;
      case 'Delay':
        delayCount++;
        traverse(term.delayedTerm);
        break;
      case 'Force':
        forceCount++;
        traverse(term.termToForce);
        break;
      case 'Builtin':
        const tag = builtinTagToString(term._tag);
        builtins[tag] = (builtins[tag] || 0) + 1;
        break;
      case 'UPLCConst':
        const val = term.value;
        if (typeof val === 'bigint') {
          integers.push(val.toString());
        } else if (val instanceof Uint8Array) {
          const hex = bufferToHex(val);
          if (hex.length > 0 && hex.length <= 128) {
            bytestrings.push(hex);
          }
        }
        break;
      case 'Constr':
        if (term.terms) {
          term.terms.forEach(traverse);
        }
        break;
      case 'Case':
        traverse(term.scrutinee);
        if (term.branches) {
          term.branches.forEach(traverse);
        }
        break;
    }
  }
  
  traverse(program._body);
  
  // Generate pretty print in aiken style
  const prettyPrint = prettyPrintUPLC(program._body, 0, 100, version);
  
  return {
    program,
    version,
    builtins,
    constants: {
      bytestrings: [...new Set(bytestrings)].slice(0, 20),
      integers: [...new Set(integers)].slice(0, 20),
    },
    stats: { lambdaCount, forceCount, delayCount, applicationCount },
    prettyPrint,
  };
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Detect UPLC term type by properties (survives minification)
function getTermType(term: any): string {
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

// Pretty print UPLC in aiken-style format
function prettyPrintUPLC(term: any, indent: number, maxLines: number, version: string): string {
  const lines: string[] = [];
  let varCounter = 0;
  
  function emit(s: string) {
    if (lines.length < maxLines) {
      lines.push(s);
    }
  }
  
  // Track variable names through lambda scopes
  function pp(term: any, depth: number, varStack: string[]) {
    if (lines.length >= maxLines) return;
    
    const pad = '  '.repeat(depth);
    const termType = getTermType(term);
    
    switch (termType) {
      case 'Application':
        emit(`${pad}[`);
        pp(term.funcTerm, depth + 1, varStack);
        pp(term.argTerm, depth + 1, varStack);
        emit(`${pad}]`);
        break;
      case 'Lambda':
        const varName = `i_${varCounter++}`;
        emit(`${pad}(lam`);
        emit(`${pad}  ${varName}`);
        pp(term.body, depth + 1, [varName, ...varStack]);
        emit(`${pad})`);
        break;
      case 'Delay':
        emit(`${pad}(delay`);
        pp(term.delayedTerm, depth + 1, varStack);
        emit(`${pad})`);
        break;
      case 'Force':
        emit(`${pad}(force`);
        pp(term.termToForce, depth + 1, varStack);
        emit(`${pad})`);
        break;
      case 'UPLCVar':
        // Convert De Bruijn index to named variable
        const idx = Number(term.deBruijn);
        const resolvedVar = idx < varStack.length ? varStack[idx] : `?_${idx}`;
        emit(`${pad}${resolvedVar}`);
        break;
      case 'Builtin':
        const tag = builtinTagToString(term._tag);
        emit(`${pad}(builtin`);
        emit(`${pad}  ${tag}`);
        emit(`${pad})`);
        break;
      case 'UPLCConst':
        const val = term.value;
        if (typeof val === 'bigint') {
          emit(`${pad}(con integer ${val})`);
        } else if (typeof val === 'boolean') {
          emit(`${pad}(con bool ${val ? 'True' : 'False'})`);
        } else if (typeof val === 'string') {
          emit(`${pad}(con string "${val.slice(0, 50)}")`);
        } else if (val instanceof Uint8Array) {
          const hex = bufferToHex(val);
          if (hex.length <= 40) {
            emit(`${pad}(con bytestring #${hex})`);
          } else {
            emit(`${pad}(con bytestring #${hex.slice(0, 40)}...)`);
          }
        } else if (val === undefined || val === null) {
          emit(`${pad}(con unit ())`);
        } else {
          emit(`${pad}(con ${typeof val})`);
        }
        break;
      case 'Constr':
        emit(`${pad}(constr ${term.index}`);
        if (term.terms) {
          term.terms.forEach((t: any) => pp(t, depth + 1, varStack));
        }
        emit(`${pad})`);
        break;
      case 'Case':
        emit(`${pad}(case`);
        pp(term.scrutinee, depth + 1, varStack);
        if (term.branches) {
          term.branches.forEach((b: any) => pp(b, depth + 1, varStack));
        }
        emit(`${pad})`);
        break;
      default:
        emit(`${pad}(? ${termType})`);
    }
  }
  
  // Start with program wrapper
  emit(`(program`);
  emit(`  ${version}`);
  pp(term, 1, []);
  emit(`)`);
  
  if (lines.length >= maxLines) {
    lines.push('  ...');
  }
  
  return lines.join('\n');
}

export function extractErrorMessages(bytes: string): string[] {
  const text = hexToText(bytes);
  const messages: string[] = [];
  const protocols: string[] = [];
  
  // Known protocol names to look for
  const knownProtocols = ['MINSWAP', 'SUNDAE', 'WINGRIDERS', 'MUESLI', 'SPECTRUM', 'JPG', 'LIQWID', 'LENFI', 'INDIGO'];
  for (const proto of knownProtocols) {
    if (text.toUpperCase().includes(proto)) {
      protocols.push(proto);
    }
  }
  
  // Error message patterns - look for meaningful phrases
  const errorPatterns = [
    /\b(not|invalid|must|failed|error|missing|expected|unauthorized|insufficient|cannot|forbidden|denied|required|already|exceeded|wrong|bad)\b/i,
    /\b(buyer|seller|owner|admin|fee|royalt|payment|collateral|stake|reward|swap|pool|mint|burn|withdraw|deposit)\b/i,
  ];
  
  // Match readable ASCII strings (6+ chars)
  const regex = /[a-zA-Z][a-zA-Z0-9 _-]{5,}[a-zA-Z]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const str = match[0].trim();
    
    // Skip binary noise patterns
    if (/^[A-Z#.]+$/.test(str)) continue;
    if (/(.)\1{3,}/.test(str)) continue;
    if (/^[0-9a-fA-F]+$/.test(str)) continue;
    if (str.length > 100) continue;
    
    const hasSpace = str.includes(' ');
    const hasErrorPattern = errorPatterns.some(p => p.test(str));
    
    if (hasSpace || hasErrorPattern) {
      messages.push(str);
    }
  }
  
  if (protocols.length > 0) {
    messages.unshift(`[Protocol: ${protocols.join(', ')}]`);
  }
  
  return [...new Set(messages)].slice(0, 15);
}

// Known Cardano protocol identifiers
const KNOWN_PROTOCOLS: Record<string, { name: string; type: string }> = {
  'minswap': { name: 'Minswap', type: 'DEX/AMM' },
  'sundae': { name: 'SundaeSwap', type: 'DEX/AMM' },
  'wingriders': { name: 'WingRiders', type: 'DEX/AMM' },
  'muesliswap': { name: 'MuesliSwap', type: 'DEX/AMM' },
  'spectrum': { name: 'Spectrum', type: 'DEX/AMM' },
  'splash': { name: 'Splash', type: 'DEX/AMM' },
  'jpg.store': { name: 'JPG Store', type: 'NFT Marketplace' },
  'jpgstore': { name: 'JPG Store', type: 'NFT Marketplace' },
  'liqwid': { name: 'Liqwid', type: 'Lending Protocol' },
  'lenfi': { name: 'Lenfi', type: 'Lending Protocol' },
  'indigo': { name: 'Indigo', type: 'Synthetic Assets' },
};

export function classifyContract(
  builtins: Record<string, number>,
  errorMessages: string[],
  rawBytes?: string
): { classification: string; protocol?: string } {
  const errorText = errorMessages.join(' ').toLowerCase();
  const builtinSet = new Set(Object.keys(builtins));
  
  // Check for known protocol names in bytes
  if (rawBytes) {
    const bytesLower = hexToText(rawBytes).toLowerCase();
    for (const [key, proto] of Object.entries(KNOWN_PROTOCOLS)) {
      if (bytesLower.includes(key)) {
        return { 
          classification: `${proto.type} (${proto.name})`, 
          protocol: proto.name
        };
      }
    }
  }
  
  // Arithmetic analysis
  const arithmeticCount = 
    (builtins['multiplyInteger'] || 0) + 
    (builtins['divideInteger'] || 0) +
    (builtins['quotientInteger'] || 0) +
    (builtins['remainderInteger'] || 0);

  // Crypto operations
  const hasCrypto = builtinSet.has('verifyEd25519Signature') || 
                   builtinSet.has('verifyEcdsaSecp256k1Signature') ||
                   builtinSet.has('sha2_256') ||
                   builtinSet.has('blake2b_256');
  
  // Data heavy (lots of datum parsing)
  const dataOps = (builtins['unConstrData'] || 0) + 
                  (builtins['unListData'] || 0) + 
                  (builtins['unMapData'] || 0) +
                  (builtins['unIData'] || 0) +
                  (builtins['unBData'] || 0);
  
  // NFT Marketplace patterns
  if (
    errorText.includes('buyer') ||
    errorText.includes('seller') ||
    errorText.includes('royalt') ||
    errorText.includes('nft') ||
    errorText.includes('sale') ||
    errorText.includes('listing')
  ) {
    return { classification: 'NFT Marketplace' };
  }
  
  // DEX/AMM patterns
  const hasDexKeywords = 
    errorText.includes('swap') ||
    errorText.includes('pool') ||
    errorText.includes('liquidity') ||
    errorText.includes('slippage') ||
    errorText.includes('amm') ||
    errorText.includes('lp token');
  
  if (hasDexKeywords || arithmeticCount >= 20) {
    return { classification: 'DEX/AMM' };
  }
  
  // Lending patterns
  if (
    errorText.includes('collateral') ||
    errorText.includes('borrow') ||
    errorText.includes('repay') ||
    errorText.includes('liquidat')
  ) {
    return { classification: 'Lending Protocol' };
  }
  
  // Staking/Governance patterns
  if (
    errorText.includes('stake') ||
    errorText.includes('reward') ||
    errorText.includes('delegate') ||
    errorText.includes('vote')
  ) {
    return { classification: 'Staking/Governance' };
  }
  
  // Multisig/Auth patterns
  if (builtinSet.has('verifyEd25519Signature') || builtinSet.has('verifyEcdsaSecp256k1Signature')) {
    return { classification: 'Multisig/Auth' };
  }
  
  // Oracle patterns
  if (errorText.includes('oracle') || errorText.includes('price feed')) {
    return { classification: 'Oracle' };
  }
  
  // Escrow/Payment patterns
  if (
    errorText.includes('fee') ||
    errorText.includes('payment') ||
    errorText.includes('escrow') ||
    errorText.includes('recipient')
  ) {
    return { classification: 'Escrow/Payment' };
  }
  
  // Token/Minting patterns
  if (
    errorText.includes('mint') ||
    errorText.includes('burn') ||
    errorText.includes('policy')
  ) {
    return { classification: 'Token/Minting' };
  }
  
  // Infer from structure
  if (dataOps > 30) {
    return { classification: 'Complex Validator (data-heavy)' };
  }
  
  if (arithmeticCount >= 10) {
    return { classification: 'DeFi (Generic)' };
  }
  
  if (hasCrypto) {
    return { classification: 'Crypto/Signature Validator' };
  }
  
  return { classification: 'Unknown' };
}

// Core analysis (fast) - fetches script and decodes UPLC
export async function analyzeScriptCore(scriptHash: string): Promise<Omit<AnalysisResult, 'datums' | 'redeemers'>> {
  const scriptInfo = await fetchScriptInfo(scriptHash);
  
  // Decode UPLC
  let decoded;
  let errorMessages: string[] = [];
  
  try {
    decoded = decodeUPLC(scriptInfo.bytes);
    errorMessages = extractErrorMessages(scriptInfo.bytes);
  } catch (e: any) {
    throw new Error(`Failed to decode UPLC: ${e.message}`);
  }
  
  // Classify
  const { classification, protocol } = classifyContract(
    decoded.builtins,
    errorMessages,
    scriptInfo.bytes
  );
  
  const totalBuiltins = Object.values(decoded.builtins).reduce((a, b) => a + b, 0);
  
  return {
    scriptInfo,
    builtins: decoded.builtins,
    errorMessages,
    constants: decoded.constants,
    classification: protocol ? `${classification}` : classification,
    version: decoded.version,
    stats: {
      totalBuiltins,
      uniqueBuiltins: Object.keys(decoded.builtins).length,
      ...decoded.stats,
    },
    uplcPreview: decoded.prettyPrint,
    datums: [],
    redeemers: [],
  };
}

// Full analysis (blocking) - for backwards compatibility
export async function analyzeScript(scriptHash: string): Promise<AnalysisResult> {
  // Fetch script from chain and on-chain data in parallel
  const [scriptInfo, datums, redeemers] = await Promise.all([
    fetchScriptInfo(scriptHash),
    fetchScriptDatums(scriptHash, 10),
    fetchScriptRedeemers(scriptHash, 10),
  ]);
  
  // Decode UPLC
  let decoded;
  let errorMessages: string[] = [];
  
  try {
    decoded = decodeUPLC(scriptInfo.bytes);
    errorMessages = extractErrorMessages(scriptInfo.bytes);
  } catch (e: any) {
    throw new Error(`Failed to decode UPLC: ${e.message}`);
  }
  
  // Classify
  const { classification, protocol } = classifyContract(
    decoded.builtins,
    errorMessages,
    scriptInfo.bytes
  );
  
  const totalBuiltins = Object.values(decoded.builtins).reduce((a, b) => a + b, 0);
  
  return {
    scriptInfo,
    builtins: decoded.builtins,
    errorMessages,
    constants: decoded.constants,
    classification: protocol ? `${classification}` : classification,
    version: decoded.version,
    stats: {
      totalBuiltins,
      uniqueBuiltins: Object.keys(decoded.builtins).length,
      ...decoded.stats,
    },
    uplcPreview: decoded.prettyPrint,
    datums,
    redeemers,
  };
}
