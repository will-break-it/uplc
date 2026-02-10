// UPLC Analyzer - Real UPLC decoding using @harmoniclabs/uplc

import { UPLCDecoder, builtinTagToString, showUPLC } from '@harmoniclabs/uplc';

export interface ScriptInfo {
  scriptHash: string;
  type: string;
  size: number;
  bytes: string;
  creationTxHash?: string;
}

export interface PatternAnalysis {
  datumUsed: boolean;
  datumOptional: boolean;
  datumFields: number;
  redeemerVariants: number;
  redeemerMatchPattern: string;
  validationChecks: number;
  checkTypes: string[];
  scriptParams: Array<{ name: string; type: string; value: string }>;
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
  // Rich pattern analysis from @uplc/patterns
  analysis?: PatternAnalysis;
  // Execution cost estimate
  cost?: {
    cpu: string;
    memory: string;
    cpuBudgetPercent: number;
    memoryBudgetPercent: number;
    breakdown: Array<{
      category: string;
      cpu: string;
      memory: string;
      count: number;
    }>;
    warnings: string[];
  };
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
  const apiUrl = '/api/koios';
    
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

  // Generate pretty print using harmoniclabs implementation
  // showUPLC expects the full program object
  let prettyPrint: string;
  try {
    const uplcOutput = showUPLC(program);
    prettyPrint = typeof uplcOutput === 'string' ? uplcOutput : String(uplcOutput);

    if (!prettyPrint || prettyPrint.trim().length === 0) {
      console.warn('showUPLC returned empty, this should not happen');
      // If showUPLC fails, we need a valid UPLC representation
      // Use a minimal valid UPLC program as fallback
      prettyPrint = `(program ${version} (error))`;
    }
  } catch (e) {
    console.error('showUPLC threw error:', e);
    prettyPrint = `(program ${version} (error))`;
  }

  return {
    program,
    version,
    builtins,
    constants: {
      bytestrings: [...new Set(bytestrings)].slice(0, 50),
      integers: [...new Set(integers)].slice(0, 50),
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

// Core analysis - fetches script and decodes UPLC
export async function analyzeScriptCore(scriptHash: string): Promise<AnalysisResult> {
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
  };
}

