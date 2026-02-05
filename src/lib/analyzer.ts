// UPLC Analyzer - Extract patterns and generate pseudo-Aiken

export interface ScriptInfo {
  scriptHash: string;
  type: string;
  size: number;
  bytes: string;
  creationTxHash?: string;
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
  mevRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  stats: {
    totalBuiltins: number;
    uniqueBuiltins: number;
    lambdaCount: number;
    forceCount: number;
  };
  pseudoAiken: string;
  uplcPreview: string;
}

// Builtin semantics for classification
const BUILTIN_CATEGORIES: Record<string, string> = {
  addInteger: 'arithmetic',
  subtractInteger: 'arithmetic',
  multiplyInteger: 'arithmetic',
  divideInteger: 'arithmetic',
  quotientInteger: 'arithmetic',
  remainderInteger: 'arithmetic',
  modInteger: 'arithmetic',
  equalsInteger: 'comparison',
  lessThanInteger: 'comparison',
  lessThanEqualsInteger: 'comparison',
  appendByteString: 'bytestring',
  equalsByteString: 'comparison',
  sha2_256: 'crypto',
  sha3_256: 'crypto',
  blake2b_256: 'crypto',
  verifyEd25519Signature: 'crypto',
  verifyEcdsaSecp256k1Signature: 'crypto',
  ifThenElse: 'control',
  trace: 'debug',
  fstPair: 'tuple',
  sndPair: 'tuple',
  headList: 'list',
  tailList: 'list',
  nullList: 'list',
  chooseList: 'list',
  mkCons: 'list',
  unConstrData: 'data',
  unMapData: 'data',
  unListData: 'data',
  unIData: 'data',
  unBData: 'data',
  constrData: 'data',
  mapData: 'data',
  listData: 'data',
  iData: 'data',
  bData: 'data',
};

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
    if (/^[A-Z#.]+$/.test(str)) continue;  // All caps/symbols
    if (/(.)\1{3,}/.test(str)) continue;   // Repeated chars (aaaa, 2222)
    if (/^[0-9a-fA-F]+$/.test(str)) continue;  // Hex-looking
    if (str.length > 100) continue;  // Too long = noise
    
    // Require meaningful content (spaces or error-like words)
    const hasSpace = str.includes(' ');
    const hasErrorPattern = errorPatterns.some(p => p.test(str));
    
    if (hasSpace || hasErrorPattern) {
      messages.push(str);
    }
  }
  
  // Add protocol detections at the start
  if (protocols.length > 0) {
    messages.unshift(`[Protocol: ${protocols.join(', ')}]`);
  }
  
  return [...new Set(messages)].slice(0, 15);  // Limit to 15 messages
}

export function extractBuiltins(uplc: string): Record<string, number> {
  const builtins: Record<string, number> = {};
  
  // Match builtin names (on same or next line after "(builtin")
  const lines = uplc.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('(builtin')) {
      // Check same line
      const sameLineMatch = lines[i].match(/\(builtin\s+(\w+)/);
      if (sameLineMatch) {
        builtins[sameLineMatch[1]] = (builtins[sameLineMatch[1]] || 0) + 1;
      } else if (i + 1 < lines.length) {
        // Check next line
        const nextLine = lines[i + 1].trim();
        if (/^[a-zA-Z]/.test(nextLine)) {
          const name = nextLine.split(/[\s\)]/)[0];
          builtins[name] = (builtins[name] || 0) + 1;
        }
      }
    }
  }
  
  return builtins;
}

// Known Cardano protocol identifiers
const KNOWN_PROTOCOLS: Record<string, { name: string; type: string; risk: 'LOW' | 'MEDIUM' | 'HIGH' }> = {
  'minswap': { name: 'Minswap', type: 'DEX/AMM', risk: 'HIGH' },
  'sundae': { name: 'SundaeSwap', type: 'DEX/AMM', risk: 'HIGH' },
  'wingriders': { name: 'WingRiders', type: 'DEX/AMM', risk: 'HIGH' },
  'muesliswap': { name: 'MuesliSwap', type: 'DEX/AMM', risk: 'HIGH' },
  'spectrum': { name: 'Spectrum', type: 'DEX/AMM', risk: 'HIGH' },
  'jpg.store': { name: 'JPG Store', type: 'NFT Marketplace', risk: 'MEDIUM' },
  'jpgstore': { name: 'JPG Store', type: 'NFT Marketplace', risk: 'MEDIUM' },
  'liqwid': { name: 'Liqwid', type: 'Lending Protocol', risk: 'HIGH' },
  'lenfi': { name: 'Lenfi', type: 'Lending Protocol', risk: 'HIGH' },
  'indigo': { name: 'Indigo', type: 'Synthetic Assets', risk: 'HIGH' },
};

export function classifyContract(
  builtins: Record<string, number>,
  errorMessages: string[],
  rawBytes?: string
): { classification: string; mevRisk: 'LOW' | 'MEDIUM' | 'HIGH'; protocol?: string } {
  const errorText = errorMessages.join(' ').toLowerCase();
  const builtinSet = new Set(Object.keys(builtins));
  
  // Check for known protocol names in bytes
  if (rawBytes) {
    const bytesLower = hexToText(rawBytes).toLowerCase();
    for (const [key, proto] of Object.entries(KNOWN_PROTOCOLS)) {
      if (bytesLower.includes(key)) {
        return { 
          classification: `${proto.type} (${proto.name})`, 
          mevRisk: proto.risk,
          protocol: proto.name
        };
      }
    }
  }
  
  // Count arithmetic operations (DEX contracts are math-heavy)
  const arithmeticCount = 
    (builtins['multiplyInteger'] || 0) + 
    (builtins['divideInteger'] || 0) +
    (builtins['quotientInteger'] || 0) +
    (builtins['remainderInteger'] || 0);
  
  // NFT Marketplace patterns
  if (
    errorText.includes('buyer') ||
    errorText.includes('seller') ||
    errorText.includes('royalt') ||
    errorText.includes('nft') ||
    errorText.includes('sale') ||
    errorText.includes('listing')
  ) {
    return { classification: 'NFT Marketplace', mevRisk: 'MEDIUM' };
  }
  
  // DEX/AMM patterns - require EITHER keywords OR heavy arithmetic (20+ ops)
  const hasDexKeywords = 
    errorText.includes('swap') ||
    errorText.includes('pool') ||
    errorText.includes('liquidity') ||
    errorText.includes('slippage') ||
    errorText.includes('amm') ||
    errorText.includes('lp token');
  
  if (hasDexKeywords || arithmeticCount >= 20) {
    return { classification: 'DEX/AMM', mevRisk: 'HIGH' };
  }
  
  // Lending patterns
  if (
    errorText.includes('collateral') ||
    errorText.includes('borrow') ||
    errorText.includes('repay') ||
    errorText.includes('liquidat')
  ) {
    return { classification: 'Lending Protocol', mevRisk: 'HIGH' };
  }
  
  // Staking/Governance patterns
  if (
    errorText.includes('stake') ||
    errorText.includes('reward') ||
    errorText.includes('delegate') ||
    errorText.includes('vote')
  ) {
    return { classification: 'Staking/Governance', mevRisk: 'LOW' };
  }
  
  // Multisig/Auth patterns
  if (builtinSet.has('verifyEd25519Signature') || builtinSet.has('verifyEcdsaSecp256k1Signature')) {
    return { classification: 'Multisig/Auth', mevRisk: 'LOW' };
  }
  
  // Oracle patterns
  if (errorText.includes('oracle') || errorText.includes('price feed')) {
    return { classification: 'Oracle', mevRisk: 'HIGH' };
  }
  
  // Escrow/Payment patterns (uses arithmetic for fee splitting)
  if (
    errorText.includes('fee') ||
    errorText.includes('payment') ||
    errorText.includes('escrow') ||
    errorText.includes('recipient')
  ) {
    return { classification: 'Escrow/Payment', mevRisk: 'LOW' };
  }
  
  // Token/Minting patterns
  if (
    errorText.includes('mint') ||
    errorText.includes('burn') ||
    errorText.includes('policy')
  ) {
    return { classification: 'Token/Minting', mevRisk: 'LOW' };
  }
  
  // If arithmetic-heavy but no keywords, might be a generic DeFi contract
  if (arithmeticCount >= 10) {
    return { classification: 'DeFi (Generic)', mevRisk: 'MEDIUM' };
  }
  
  return { classification: 'Unknown', mevRisk: 'MEDIUM' };
}

export function generatePseudoAiken(
  classification: string,
  errorMessages: string[],
  builtins: Record<string, number>,
  scriptHash: string
): string {
  const lines: string[] = [];
  
  lines.push(`// ============================================================`);
  lines.push(`// DECOMPILED: ${scriptHash}`);
  lines.push(`// Classification: ${classification}`);
  lines.push(`// ============================================================`);
  lines.push('');
  
  // Only show error messages if we found meaningful ones
  const meaningfulMessages = errorMessages.filter(msg => 
    !msg.startsWith('[Protocol:') && 
    msg.length > 3 && 
    /[a-z]{3,}/i.test(msg)
  );
  
  if (meaningfulMessages.length > 0) {
    lines.push('// Error messages found in contract:');
    for (const msg of meaningfulMessages.slice(0, 10)) {
      lines.push(`// - "${msg}"`);
    }
    lines.push('');
  }
  
  // Generate structure based on classification
  if (classification === 'NFT Marketplace') {
    lines.push('validator nft_marketplace {');
    lines.push('  fn spend(datum: Datum, redeemer: Redeemer, ctx: ScriptContext) -> Bool {');
    lines.push('    when redeemer is {');
    lines.push('      Buy -> {');
    for (const msg of errorMessages) {
      if (msg.toLowerCase().includes('buyer') || msg.toLowerCase().includes('paid')) {
        lines.push(`        // Validates: "${msg}"`);
      }
    }
    lines.push('        nft_sent_to_buyer && seller_paid && fees_paid');
    lines.push('      }');
    lines.push('      Cancel -> signed_by_seller');
    lines.push('    }');
    lines.push('  }');
    lines.push('}');
  } else if (classification === 'DEX/AMM') {
    lines.push('validator amm_pool {');
    lines.push('  fn spend(datum: PoolState, redeemer: Action, ctx: ScriptContext) -> Bool {');
    lines.push('    when redeemer is {');
    lines.push('      Swap { amount_in, min_out } -> {');
    lines.push('        // Uses: multiplyInteger, divideInteger for price calculation');
    lines.push('        check_swap_math(datum, amount_in, min_out)');
    lines.push('      }');
    lines.push('      AddLiquidity { .. } -> check_lp_mint(datum, ctx)');
    lines.push('      RemoveLiquidity { .. } -> check_lp_burn(datum, ctx)');
    lines.push('    }');
    lines.push('  }');
    lines.push('}');
  } else if (classification === 'Lending Protocol') {
    lines.push('validator lending_pool {');
    lines.push('  fn spend(datum: LoanState, redeemer: Action, ctx: ScriptContext) -> Bool {');
    lines.push('    when redeemer is {');
    lines.push('      Borrow { amount } -> check_collateral_ratio(datum, amount)');
    lines.push('      Repay { amount } -> check_repayment(datum, amount)');
    lines.push('      Liquidate -> check_undercollateralized(datum)');
    lines.push('    }');
    lines.push('  }');
    lines.push('}');
  } else {
    // For unknown contracts, show what we can infer
    const builtinList = Object.entries(builtins)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    
    const cats = new Set(Object.keys(builtins).map(b => BUILTIN_CATEGORIES[b] || 'unknown'));
    const catList = [...cats].filter(c => c !== 'unknown');
    
    if (builtinList.length === 0) {
      lines.push('// Minimal contract - likely a simple minting policy or always-succeeds validator');
      lines.push('validator minimal {');
      lines.push('  fn spend(_datum: Data, _redeemer: Data, _ctx: ScriptContext) -> Bool {');
      lines.push('    True  // or simple condition');
      lines.push('  }');
      lines.push('}');
    } else {
      lines.push(`validator contract {`);
      lines.push('  fn spend(datum: Datum, redeemer: Redeemer, ctx: ScriptContext) -> Bool {');
      if (catList.length > 0) {
        lines.push(`    // Operations: ${catList.join(', ')}`);
      }
      lines.push('    // Top builtins:');
      for (const [name, count] of builtinList) {
        lines.push(`    //   ${name}: ${count}x`);
      }
      lines.push('    // ... (structure unclear from bytecode)');
      lines.push('  }');
      lines.push('}');
    }
  }
  
  return lines.join('\n');
}

export function analyzeUplc(uplc: string): {
  builtins: Record<string, number>;
  lambdaCount: number;
  forceCount: number;
  preview: string;
} {
  const builtins = extractBuiltins(uplc);
  const lambdaCount = (uplc.match(/\(lam/g) || []).length;
  const forceCount = (uplc.match(/\(force/g) || []).length;
  
  // Get first 100 lines as preview
  const lines = uplc.split('\n');
  const preview = lines.slice(0, 100).join('\n') + (lines.length > 100 ? '\n...' : '');
  
  return { builtins, lambdaCount, forceCount, preview };
}
