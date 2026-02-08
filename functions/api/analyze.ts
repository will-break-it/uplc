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
  traceStrings: string[];
  constants: {
    bytestrings: string[];
    integers: string[];
  };
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

// Convert Uint8Array to hex string
function bufferToHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Decode CBOR to UPLC and extract stats
function decodeAndAnalyze(bytes: string): {
  uplc: string;
  version: string;
  builtins: Record<string, number>;
  traceStrings: string[];
  constants: { bytestrings: string[]; integers: string[] };
  stats: { lambdaCount: number; forceCount: number; delayCount: number; applicationCount: number };
} {
  const innerHex = stripCborWrapper(bytes);
  const buffer = hexToBuffer(innerHex);
  const program = UPLCDecoder.parse(buffer, "flat");
  
  const version = `${program._version._major}.${program._version._minor}.${program._version._patch}`;
  
  const builtins: Record<string, number> = {};
  const traceStrings: string[] = [];
  const bytestrings: string[] = [];
  const integers: string[] = [];
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

  // Check if term is a trace builtin (possibly wrapped in force)
  function isTraceBuiltin(term: any): boolean {
    if (!term) return false;
    const type = getType(term);
    if (type === 'Builtin') {
      return builtinTagToString(term._tag) === 'trace';
    }
    if (type === 'Force') {
      return isTraceBuiltin(term.termToForce);
    }
    return false;
  }

  // Extract string from a constant term
  function extractString(term: any): string | null {
    if (!term) return null;
    const type = getType(term);
    if (type === 'UPLCConst' && term.value) {
      // Check for string type
      if (typeof term.value === 'string') return term.value;
      if (term.value.value && typeof term.value.value === 'string') return term.value.value;
      // Check for bytestring that might be a trace message
      if (term.value.value instanceof Uint8Array) {
        try {
          return new TextDecoder().decode(term.value.value);
        } catch { return null; }
      }
    }
    return null;
  }

  function traverse(term: any) {
    if (!term) return;
    const termType = getType(term);
    
    switch (termType) {
      case 'Application':
        applicationCount++;
        // Check for trace builtin application: (trace "message" ...)
        if (isTraceBuiltin(term.funcTerm)) {
          const msg = extractString(term.argTerm);
          if (msg && !traceStrings.includes(msg)) {
            traceStrings.push(msg);
          }
        }
        // Also check for partially applied trace: ((trace "message") term)
        if (getType(term.funcTerm) === 'Application') {
          const inner = term.funcTerm;
          if (isTraceBuiltin(inner.funcTerm)) {
            const msg = extractString(inner.argTerm);
            if (msg && !traceStrings.includes(msg)) {
              traceStrings.push(msg);
            }
          }
        }
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
        if (term.value) {
          const val = term.value;
          if (typeof val === 'bigint') {
            const intStr = val.toString();
            if (!integers.includes(intStr)) {
              integers.push(intStr);
            }
          } else if (val instanceof Uint8Array) {
            const hex = bufferToHex(val);
            // Only include meaningful-length bytestrings (not empty or too short)
            if (hex.length >= 8 && !bytestrings.includes(hex)) {
              bytestrings.push(hex);
            }
          } else if (val.value !== undefined) {
            // Wrapped value (harmoniclabs format)
            if (typeof val.value === 'bigint') {
              const intStr = val.value.toString();
              if (!integers.includes(intStr)) {
                integers.push(intStr);
              }
            } else if (val.value instanceof Uint8Array) {
              const hex = bufferToHex(val.value);
              if (hex.length >= 8 && !bytestrings.includes(hex)) {
                bytestrings.push(hex);
              }
            }
          }
        }
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
    traceStrings,
    constants: {
      bytestrings: bytestrings.slice(0, 50),  // Limit to 50
      integers: integers.slice(0, 50),
    },
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
    const url = new URL(context.request.url);
    let scriptHash: string | null = null;
    
    if (context.request.method === 'GET') {
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

    // Check cache for full analysis (skip if nocache=1)
    const nocache = url.searchParams.get('nocache') === '1';
    const cacheKey = `analysis:${scriptHash}`;
    if (context.env.UPLC_CACHE && !nocache) {
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
      traceStrings: decoded.traceStrings,
      constants: decoded.constants,
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
