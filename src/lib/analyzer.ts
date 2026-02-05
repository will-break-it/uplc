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
  // Convert hex to text and extract readable strings
  const text = hexToText(bytes);
  const messages: string[] = [];
  
  // Match readable ASCII strings (8+ chars with spaces/punctuation)
  const regex = /[\x20-\x7E]{8,}/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const str = match[0].trim();
    // Filter out noise - keep messages with lowercase letters
    if (/[a-z]/.test(str) && !/^[0-9#]+$/.test(str)) {
      messages.push(str);
    }
  }
  
  return [...new Set(messages)];
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

export function classifyContract(
  builtins: Record<string, number>,
  errorMessages: string[]
): { classification: string; mevRisk: 'LOW' | 'MEDIUM' | 'HIGH' } {
  const errorText = errorMessages.join(' ').toLowerCase();
  const builtinSet = new Set(Object.keys(builtins));
  
  // NFT Marketplace patterns
  if (
    errorText.includes('buyer') ||
    errorText.includes('seller') ||
    errorText.includes('royalt') ||
    errorText.includes('nft')
  ) {
    return { classification: 'NFT Marketplace', mevRisk: 'MEDIUM' };
  }
  
  // DEX/AMM patterns
  if (
    (builtinSet.has('multiplyInteger') && builtinSet.has('divideInteger')) ||
    errorText.includes('swap') ||
    errorText.includes('pool') ||
    errorText.includes('liquidity') ||
    errorText.includes('slippage')
  ) {
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
  
  lines.push('// Error messages found in contract:');
  for (const msg of errorMessages.slice(0, 10)) {
    lines.push(`// - "${msg}"`);
  }
  lines.push('');
  
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
    lines.push(`validator ${classification.toLowerCase().replace(/[^a-z]/g, '_')} {`);
    lines.push('  fn spend(datum: Datum, redeemer: Redeemer, ctx: ScriptContext) -> Bool {');
    lines.push('    // Contract logic inferred from builtins:');
    const cats = new Set(Object.keys(builtins).map(b => BUILTIN_CATEGORIES[b] || 'unknown'));
    for (const cat of cats) {
      lines.push(`    // - ${cat} operations`);
    }
    lines.push('    todo');
    lines.push('  }');
    lines.push('}');
  }
  
  return lines.join('\n');
}

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
