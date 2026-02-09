/**
 * Full analysis endpoint with caching
 * 
 * Pipeline: script_hash → CBOR → AST → Analysis → Decompiled
 * All stages cached in KV (immutable once computed)
 */

import { UPLCDecoder, builtinTagToString, prettyUPLC } from '@harmoniclabs/uplc';
import { convertFromHarmoniclabs } from '@uplc/parser';
import { analyzeContract } from '@uplc/patterns';
import { generate, estimateCost, getCostWarnings } from '@uplc/codegen';

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
  aikenCode: string;
  uplcText: string;  // Pretty-printed UPLC
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
  // Execution cost estimate
  cost: {
    cpu: string;        // CPU units (as string for bigint)
    memory: string;     // Memory units
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
  // Rich analysis from @uplc/patterns
  analysis: {
    datumUsed: boolean;
    datumOptional: boolean;
    datumFields: number;
    redeemerVariants: number;
    redeemerMatchPattern: string;
    validationChecks: number;
    checkTypes: string[];
    scriptParams: Array<{ name: string; type: string; value: string }>;
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

// Decode CBOR and perform full analysis
function decodeAndAnalyze(bytes: string): {
  version: string;
  aikenCode: string;
  uplcText: string;
  scriptPurpose: string;
  builtins: Record<string, number>;
  traceStrings: string[];
  constants: { bytestrings: string[]; integers: string[] };
  stats: { lambdaCount: number; forceCount: number; delayCount: number; applicationCount: number };
  analysis: {
    datumUsed: boolean;
    datumOptional: boolean;
    datumFields: number;
    redeemerVariants: number;
    redeemerMatchPattern: string;
    validationChecks: number;
    checkTypes: string[];
    scriptParams: Array<{ name: string; type: string; value: string }>;
  };
} {
  const innerHex = stripCborWrapper(bytes);
  const buffer = hexToBuffer(innerHex);
  const program = UPLCDecoder.parse(buffer, "flat");
  
  const version = `${program._version._major}.${program._version._minor}.${program._version._patch}`;
  
  // Convert to our AST (no text round-trip)
  const ast = convertFromHarmoniclabs(program.body);
  
  // Analyze patterns
  const structure = analyzeContract(ast);
  
  // Generate Aiken code
  const aikenCode = generate(structure);
  
  // Generate pretty-printed UPLC text
  const uplcText = prettyUPLC(program.body);
  
  // Extract stats from AST
  const builtins: Record<string, number> = {};
  const traceStrings: string[] = [];
  const bytestrings: string[] = [];
  const integers: string[] = [];
  let lambdaCount = 0, forceCount = 0, delayCount = 0, applicationCount = 0;
  
  function traverseAst(term: any) {
    if (!term) return;
    
    switch (term.tag) {
      case 'app':
        applicationCount++;
        // Check for trace applications
        if (term.func?.tag === 'builtin' && term.func.name === 'trace') {
          if (term.arg?.tag === 'con' && term.arg.value?.tag === 'string') {
            const msg = term.arg.value.value;
            if (msg && !traceStrings.includes(msg)) {
              traceStrings.push(msg);
            }
          }
        }
        // Check for nested trace: ((trace "msg") ...)
        if (term.func?.tag === 'app' && term.func.func?.tag === 'builtin' && term.func.func.name === 'trace') {
          if (term.func.arg?.tag === 'con' && term.func.arg.value?.tag === 'string') {
            const msg = term.func.arg.value.value;
            if (msg && !traceStrings.includes(msg)) {
              traceStrings.push(msg);
            }
          }
        }
        traverseAst(term.func);
        traverseAst(term.arg);
        break;
      case 'lam':
        lambdaCount++;
        traverseAst(term.body);
        break;
      case 'delay':
        delayCount++;
        traverseAst(term.term);
        break;
      case 'force':
        forceCount++;
        traverseAst(term.term);
        break;
      case 'builtin':
        builtins[term.name] = (builtins[term.name] || 0) + 1;
        break;
      case 'con':
        if (term.value) {
          const val = term.value;
          if (val.tag === 'integer') {
            const intStr = val.value.toString();
            if (!integers.includes(intStr)) {
              integers.push(intStr);
            }
          } else if (val.tag === 'bytestring' && val.value instanceof Uint8Array) {
            const hex = bufferToHex(val.value);
            if (hex.length >= 8 && !bytestrings.includes(hex)) {
              bytestrings.push(hex);
            }
          }
        }
        break;
      case 'case':
        traverseAst(term.scrutinee);
        term.branches?.forEach(traverseAst);
        break;
      case 'constr':
        term.args?.forEach(traverseAst);
        break;
    }
  }
  
  traverseAst(ast);
  
  // Also traverse raw AST from harmoniclabs for trace strings (more reliable)
  function traverseRaw(term: any) {
    if (!term) return;
    const termType = getTermType(term);
    
    if (termType === 'Application') {
      // Check for trace builtin
      if (isTraceBuiltin(term.funcTerm)) {
        const msg = extractStringFromRaw(term.argTerm);
        if (msg && !traceStrings.includes(msg)) {
          traceStrings.push(msg);
        }
      }
      if (getTermType(term.funcTerm) === 'Application') {
        const inner = term.funcTerm;
        if (isTraceBuiltin(inner.funcTerm)) {
          const msg = extractStringFromRaw(inner.argTerm);
          if (msg && !traceStrings.includes(msg)) {
            traceStrings.push(msg);
          }
        }
      }
      traverseRaw(term.funcTerm);
      traverseRaw(term.argTerm);
    } else if (termType === 'Lambda') {
      traverseRaw(term.body);
    } else if (termType === 'Delay') {
      traverseRaw(term.delayedTerm);
    } else if (termType === 'Force') {
      traverseRaw(term.termToForce);
    } else if (termType === 'Constr') {
      term.terms?.forEach(traverseRaw);
    } else if (termType === 'Case') {
      traverseRaw(term.scrutinee);
      term.branches?.forEach(traverseRaw);
    }
  }
  
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
  
  function isTraceBuiltin(term: any): boolean {
    if (!term) return false;
    const type = getTermType(term);
    if (type === 'Builtin') {
      return builtinTagToString(term._tag) === 'trace';
    }
    if (type === 'Force') {
      return isTraceBuiltin(term.termToForce);
    }
    return false;
  }
  
  function extractStringFromRaw(term: any): string | null {
    if (!term) return null;
    const type = getTermType(term);
    if (type === 'UPLCConst' && term.value) {
      if (typeof term.value === 'string') return term.value;
      if (term.value.value && typeof term.value.value === 'string') return term.value.value;
      if (term.value.value instanceof Uint8Array) {
        try { return new TextDecoder().decode(term.value.value); }
        catch { return null; }
      }
    }
    return null;
  }
  
  traverseRaw(program._body);
  
  // Collect check types
  const checkTypes = [...new Set(structure.checks.map(c => c.type))];
  
  return {
    version,
    aikenCode,
    uplcText,
    scriptPurpose: structure.type,
    builtins,
    traceStrings,
    constants: {
      bytestrings: bytestrings.slice(0, 50),
      integers: integers.slice(0, 50),
    },
    stats: { lambdaCount, forceCount, delayCount, applicationCount },
    analysis: {
      datumUsed: structure.datum.isUsed,
      datumOptional: structure.datum.isOptional,
      datumFields: structure.datum.fields.length,
      redeemerVariants: structure.redeemer.variants.length,
      redeemerMatchPattern: structure.redeemer.matchPattern,
      validationChecks: structure.checks.length,
      checkTypes,
      scriptParams: structure.scriptParams || [],
    },
  };
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
      return new Response(
        JSON.stringify({ error: 'Invalid script hash. Must be 56 hex characters.' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(corsOrigin) } }
      );
    }

    const cacheKey = `analysis:v5:${scriptHash}`;  // v5: added uplcText

    // Check cache
    if (context.env.UPLC_CACHE) {
      const cached = await context.env.UPLC_CACHE.get(cacheKey);
      if (cached) {
        const result = JSON.parse(cached) as AnalysisResult;
        result.cached = true;
        return new Response(JSON.stringify(result), {
          headers: {
            'Content-Type': 'application/json',
            'X-Cache': 'hit',
            'Cache-Control': 'public, max-age=31536000, immutable',
            ...corsHeaders(corsOrigin),
          },
        });
      }
    }

    // Fetch from Koios
    const koiosResponse = await fetch('https://api.koios.rest/api/v1/script_info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _script_hashes: [scriptHash] }),
    });

    if (!koiosResponse.ok) {
      return new Response(
        JSON.stringify({ error: `Koios API error: ${koiosResponse.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders(corsOrigin) } }
      );
    }

    const scripts = await koiosResponse.json() as ScriptInfo[];
    if (!scripts || scripts.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Script not found on chain' }),
        { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders(corsOrigin) } }
      );
    }

    const script = scripts[0];
    
    if (!script.bytes) {
      return new Response(
        JSON.stringify({ error: 'Script is a native script (no Plutus bytecode)' }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders(corsOrigin) } }
      );
    }

    // Decode and analyze
    const decoded = decodeAndAnalyze(script.bytes);
    
    // Estimate execution cost
    const costEstimate = estimateCost(decoded.builtins);
    const costWarnings = getCostWarnings(decoded.builtins);

    const result: AnalysisResult = {
      scriptHash: script.script_hash,
      scriptType: script.type,
      size: script.size,
      bytes: script.bytes,
      version: decoded.version,
      aikenCode: decoded.aikenCode,
      uplcText: decoded.uplcText,
      scriptPurpose: decoded.scriptPurpose,
      builtins: decoded.builtins,
      traceStrings: decoded.traceStrings,
      constants: decoded.constants,
      stats: {
        totalBuiltins: Object.values(decoded.builtins).reduce((a, b) => a + b, 0),
        uniqueBuiltins: Object.keys(decoded.builtins).length,
        ...decoded.stats,
      },
      cost: {
        cpu: costEstimate.cpu.toString(),
        memory: costEstimate.memory.toString(),
        cpuBudgetPercent: costEstimate.budgetPercent.cpu,
        memoryBudgetPercent: costEstimate.budgetPercent.memory,
        breakdown: costEstimate.breakdown.map(b => ({
          category: b.category,
          cpu: b.cpu.toString(),
          memory: b.memory.toString(),
          count: b.count,
        })),
        warnings: costWarnings,
      },
      analysis: decoded.analysis,
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
