/**
 * Shared analyzer utilities for serverless functions
 * This mirrors the frontend analyzer.ts but can run in Cloudflare Workers
 */

import { decode } from '@blaze-cardano/uplc';

interface ScriptInfo {
  script_hash: string;
  bytes: string;
  type: string;
  size: number;
}

interface BuiltinStats {
  [key: string]: number;
}

interface DecodeResult {
  version: string;
  builtins: BuiltinStats;
  constants: any;
  prettyPrint: string;
  stats: {
    complexity: number;
    depth: number;
  };
}

/**
 * Fetch script info from Koios
 */
export async function fetchScriptInfo(scriptHash: string): Promise<ScriptInfo> {
  const response = await fetch('https://api.koios.rest/api/v1/script_info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ _script_hashes: [scriptHash] }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch script from Koios: ${response.status}`);
  }

  const data = await response.json() as ScriptInfo[];
  if (!data || data.length === 0) {
    throw new Error('Script not found');
  }

  return data[0];
}

/**
 * Decode UPLC bytecode
 */
export function decodeUPLC(cbor: string): DecodeResult {
  const result = decode(cbor);

  return {
    version: result.version,
    builtins: result.builtins,
    constants: result.constants,
    prettyPrint: result.prettyPrint,
    stats: {
      complexity: result.stats?.complexity || 0,
      depth: result.stats?.depth || 0,
    },
  };
}

/**
 * Extract error messages from UPLC bytecode
 */
export function extractErrorMessages(cbor: string): string[] {
  try {
    const result = decode(cbor);
    return result.errorMessages || [];
  } catch {
    return [];
  }
}

/**
 * Classify contract type based on builtins and error messages
 */
export function classifyContract(
  builtins: BuiltinStats,
  errorMessages: string[],
  cbor: string
): { classification: string; protocol?: string } {
  // Simple classification logic
  // TODO: Enhance with more sophisticated pattern matching

  const topBuiltins = Object.keys(builtins).sort((a, b) => builtins[b] - builtins[a]).slice(0, 5);

  // Check for common DeFi patterns
  if (topBuiltins.includes('verifyEd25519Signature') || topBuiltins.includes('verifySchnorrSecp256k1Signature')) {
    return { classification: 'Multi-signature validator', protocol: 'Multi-sig' };
  }

  if (errorMessages.some(msg => msg.toLowerCase().includes('deadline'))) {
    return { classification: 'Time-locked contract', protocol: 'Vesting' };
  }

  if (errorMessages.some(msg => msg.toLowerCase().includes('nft')) || topBuiltins.includes('appendString')) {
    return { classification: 'NFT validator', protocol: 'NFT' };
  }

  return { classification: 'General validator' };
}
