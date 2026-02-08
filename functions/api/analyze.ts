/**
 * Full analysis endpoint with caching
 * 
 * Pipeline: script_hash → CBOR → UPLC → Decompiled
 * All stages cached in KV (immutable once computed)
 */

import { UPLCDecoder, showUPLC, builtinTagToString } from '@harmoniclabs/uplc';
import { parseUplc } from '@uplc/parser';
import { analyzeContract } from '@uplc/patterns';
import { generate } from '@uplc/codegen';

interface Env {
  UPLC_CACHE?: KVNamespace;
}

interface ScriptInfo {
  script_hash: string;
  creation_tx_hash: string;
  type: string;
  bytes: string;
  size: number;
}

interface AnalysisResult {
  scriptHash: string;
  scriptType: string;
  size: number;
  bytes: string;  // CBOR hex
  version: string;
  uplc: string;
  aikenCode: string;
  scriptPurpose: string;
  builtins: Record<string, number>;
  stats: {
    totalBuiltins: number;
    uniqueBuiltins: number;
    lambdaCount: number;
    forceCount: number;
    delayCount: number;
    applicationCount: number;
  };
  cached: boolean;
}

const ALLOWED_ORIGINS = [
  'https://uplc.wtf',
  'https://www.uplc.wtf',
  'https://uplc.pages.dev',
];

function getCorsOrigin(request: Request): string {
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.includes(origin) || origin.startsWith('http://localhost:')) {
    return origin;
  }
  return 'https://uplc.wtf';
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Convert hex to Uint8Array
function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// Strip CBOR wrapper from script bytes
function stripCborWrapper(cbor: string): string {
  if (cbor.startsWith('59')) return cbor.slice(6);
  if (cbor.startsWith('58')) return cbor.slice(4);
  if (cbor.startsWith('5a')) return cbor.slice(10);
  return cbor;
}

// Decode CBOR to UPLC and extract stats
function decodeAndAnalyze(bytes: string): {
  uplc: string;
  version: string;
  builtins: Record<string, number>;
  stats: { lambdaCount: number; forceCount: number; delayCount: number; applicationCount: number };
} {
  const innerHex = stripCborWrapper(bytes);
  const buffer = hexToBuffer(innerHex);
  const program = UPLCDecoder.parse(buffer, "flat");
  
  const version = `${program._version._major}.${program._version._minor}.${program._version._patch}`;
  
  const builtins: Record<string, number> = {};
  let lambdaCount = 0, forceCount = 0, delayCount = 0, applicationCount = 0;
  
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
      case 'Constr':
        term.terms?.forEach(traverse);
        break;
      case 'Case':
        traverse(term.scrutinee);
        term.branches?.forEach(traverse);
        break;
    }
  }
  
  traverse(program._body);
  
  const uplc = showUPLC(program.body);
  
  return {
    uplc: typeof uplc === 'string' ? uplc : String(uplc),
    version,
    builtins,
    stats: { lambdaCount, forceCount, delayCount, applicationCount },
  };
}

// Decompile UPLC to Aiken
function decompileToAiken(uplcText: string): { aikenCode: string; scriptPurpose: string } {
  try {
    const ast = parseUplc(uplcText);
    const structure = analyzeContract(ast);
    const code = generate(structure);
    return {
      aikenCode: code,
      scriptPurpose: structure.type,
    };
  } catch (e) {
    return {
      aikenCode: `// Decompilation failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
      scriptPurpose: 'unknown',
    };
  }
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const corsOrigin = getCorsOrigin(context.request);
  
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(corsOrigin) });
  }

  try {
    // Get script hash from request
    let scriptHash: string | null = null;
    
    if (context.request.method === 'GET') {
      const url = new URL(context.request.url);
      scriptHash = url.searchParams.get('hash');
    } else if (context.request.method === 'POST') {
      const body = await context.request.json() as { hash?: string };
      scriptHash = body.hash || null;
    }

    if (!scriptHash || !/^[a-f0-9]{56}$/i.test(scriptHash)) {
      return new Response(JSON.stringify({ error: 'Invalid script hash. Must be 56 hex characters.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(corsOrigin) },
      });
    }

    // Check cache for full analysis
    const cacheKey = `analysis:${scriptHash}`;
    if (context.env.UPLC_CACHE) {
      const cached = await context.env.UPLC_CACHE.get(cacheKey, 'json') as AnalysisResult | null;
      if (cached) {
        return new Response(JSON.stringify({ ...cached, cached: true }), {
          headers: {
            'Content-Type': 'application/json',
            'X-Cache': 'hit',
            'Cache-Control': 'public, max-age=31536000, immutable',
            ...corsHeaders(corsOrigin),
          },
        });
      }
    }

    // Fetch script from Koios (or KV cache via our koios endpoint)
    const koiosUrl = new URL('/api/koios', context.request.url);
    const koiosResponse = await fetch(koiosUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _script_hashes: [scriptHash] }),
    });

    if (!koiosResponse.ok) {
      return new Response(JSON.stringify({ error: `Failed to fetch script: ${koiosResponse.statusText}` }), {
        status: koiosResponse.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(corsOrigin) },
      });
    }

    const scripts = await koiosResponse.json() as ScriptInfo[];
    if (!scripts || scripts.length === 0) {
      return new Response(JSON.stringify({ error: 'Script not found on chain' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(corsOrigin) },
      });
    }

    const script = scripts[0];

    // Decode CBOR → UPLC
    const decoded = decodeAndAnalyze(script.bytes);
    
    // Decompile UPLC → Aiken
    const decompiled = decompileToAiken(decoded.uplc);

    const result: AnalysisResult = {
      scriptHash: script.script_hash,
      scriptType: script.type,
      size: script.size,
      bytes: script.bytes,
      version: decoded.version,
      uplc: decoded.uplc,
      aikenCode: decompiled.aikenCode,
      scriptPurpose: decompiled.scriptPurpose,
      builtins: decoded.builtins,
      stats: {
        totalBuiltins: Object.values(decoded.builtins).reduce((a, b) => a + b, 0),
        uniqueBuiltins: Object.keys(decoded.builtins).length,
        ...decoded.stats,
      },
      cached: false,
    };

    // Cache the full analysis (immutable)
    if (context.env.UPLC_CACHE) {
      context.waitUntil(
        context.env.UPLC_CACHE.put(cacheKey, JSON.stringify(result))
      );
    }

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': 'miss',
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...corsHeaders(corsOrigin),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(corsOrigin) },
    });
  }
};
