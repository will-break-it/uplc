/**
 * Full analysis endpoint with caching
 * 
 * Pipeline: script_hash → CBOR → AST → Analysis → Decompiled
 * Uses Blockfrost for on-chain data.
 */

import { UPLCDecoder, builtinTagToString, showUPLC } from '@harmoniclabs/uplc';
import { convertFromHarmoniclabs } from '@uplc/parser';
import { analyzeContract } from '@uplc/patterns';
import { generate, estimateCost, getCostWarnings } from '@uplc/codegen';
import type { MachineCostParams } from '@uplc/codegen';
import {
  type BlockfrostEnv, type EpochCostData, type ExecutionStats,
  getCorsOrigin, corsHeaders, optionsResponse, jsonError, jsonOk,
  fetchScript, fetchEpochCosts, fetchExecutionStats, verifyScriptHashes,
} from './_blockfrost';

type Env = BlockfrostEnv;

interface AnalysisResult {
  scriptHash: string;
  scriptType: string;
  size: number;
  bytes: string;
  version: string;
  aikenCode: string;
  uplcText: string;
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
    variableCount: number;
    constantCount: number;
    constrCount: number;
    caseCount: number;
  };
  cost: {
    cpu: string;
    memory: string;
    cpuBudgetPercent: number;
    memoryBudgetPercent: number;
    breakdown: Array<{
      category: string;
      cpu: string;
      memory: string;
      count: number;
      builtins: string[];
    }>;
    warnings: string[];
  };
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
  /** Actual on-chain execution costs from recent transactions */
  executionCosts?: ExecutionStats;
  /** 56-char hex values confirmed as on-chain script hashes */
  verifiedScriptHashes?: string[];
  cached: boolean;
}

// Convert hex to Uint8Array
function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Recursively extract bytestrings and integers from a constant value.
 * Handles: plain bytestring/integer, Data-encoded (Constr, List, Map, B, I).
 */
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
      // Recurse into the Data payload
      extractDataValues(val.value, bytestrings, integers);
      break;
    case 'list':
      // List of values — check val.value, val.items, val.list (different AST formats)
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

/**
 * Extract values from PlutusData structures (B, I, Constr, List, Map).
 */
function extractDataValues(data: any, bytestrings: string[], integers: string[]) {
  if (!data) return;
  
  // Handle bytes (B #hex)
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
  
  // Handle integer (I n)
  if (data.tag === 'int' || data.tag === 'I') {
    const intStr = (data.value ?? data).toString();
    if (!integers.includes(intStr)) integers.push(intStr);
    return;
  }
  
  // Handle Constr (Constr idx [fields...])
  if (data.tag === 'constr' || data.fields) {
    const fields = data.fields || data.value?.fields || [];
    if (Array.isArray(fields)) {
      for (const field of fields) extractDataValues(field, bytestrings, integers);
    }
    return;
  }
  
  // Handle List ([items...])
  if (data.tag === 'list' || Array.isArray(data.value)) {
    const items = Array.isArray(data.value) ? data.value : (data.list || []);
    for (const item of items) extractDataValues(item, bytestrings, integers);
    return;
  }
  
  // Handle Map ({k: v, ...})
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
  
  // Fallback: check for raw Uint8Array (harmoniclabs sometimes wraps differently)
  if (data instanceof Uint8Array) {
    const hex = bufferToHex(data);
    if (hex.length >= 8 && !bytestrings.includes(hex)) bytestrings.push(hex);
  }
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
  stats: {
    lambdaCount: number; forceCount: number; delayCount: number; applicationCount: number;
    variableCount: number; constantCount: number; constrCount: number; caseCount: number;
  };
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
  
  // Generate compact UPLC text
  const uplcText = showUPLC(program.body);
  
  // Extract stats from AST
  const builtins: Record<string, number> = {};
  const traceStrings: string[] = [];
  const bytestrings: string[] = [];
  const integers: string[] = [];
  let lambdaCount = 0, forceCount = 0, delayCount = 0, applicationCount = 0;
  let variableCount = 0, constantCount = 0, constrCount = 0, caseCount = 0;
  
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
      case 'var':
        variableCount++;
        break;
      case 'builtin':
        builtins[term.name] = (builtins[term.name] || 0) + 1;
        break;
      case 'con':
        constantCount++;
        if (term.value) {
          extractConstantValues(term.value, bytestrings, integers);
        }
        break;
      case 'case':
        caseCount++;
        traverseAst(term.scrutinee);
        term.branches?.forEach(traverseAst);
        break;
      case 'constr':
        constrCount++;
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
    } else if (termType === 'UPLCConst') {
      // Extract bytestrings/integers from raw constants (including Data-encoded)
      extractRawConstValues(term.value, bytestrings, integers);
    } else if (termType === 'Constr') {
      term.terms?.forEach(traverseRaw);
    } else if (termType === 'Case') {
      traverseRaw(term.scrutinee);
      term.branches?.forEach(traverseRaw);
    }
  }
  
  /**
   * Extract values from harmoniclabs raw constant values.
   * Handles DataConstr ({constr, fields}), DataB ({bytes: {_bytes}}),
   * DataI ({int}), plain arrays (list data), ByteString ({_bytes}).
   */
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
    
    // ByteString wrapper: { _bytes: Uint8Array }
    if (val._bytes instanceof Uint8Array) {
      const hex = bufferToHex(val._bytes);
      if (hex.length >= 8 && !bs.includes(hex)) bs.push(hex);
      return;
    }
    // DataConstr: { constr: bigint, fields: [...] }
    if (Array.isArray(val.fields)) {
      for (const f of val.fields) extractRawConstValues(f, bs, ints);
    }
    // DataB: { bytes: { _bytes: Uint8Array } }
    if (val.bytes && val.bytes._bytes instanceof Uint8Array) {
      const hex = bufferToHex(val.bytes._bytes);
      if (hex.length >= 8 && !bs.includes(hex)) bs.push(hex);
    }
    // DataI: { int: bigint }
    if (val.int !== undefined) {
      const s = val.int.toString();
      if (!ints.includes(s)) ints.push(s);
    }
    // Plain array (list data constants)
    if (Array.isArray(val)) {
      for (const item of val) extractRawConstValues(item, bs, ints);
    }
    // DataList: { list: [...] }
    if (Array.isArray(val.list)) {
      for (const item of val.list) extractRawConstValues(item, bs, ints);
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
    stats: { lambdaCount, forceCount, delayCount, applicationCount, variableCount, constantCount, constrCount, caseCount },
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
    return optionsResponse(corsOrigin);
  }

  try {
    const url = new URL(context.request.url);
    let scriptHash: string | null = null;
    
    if (context.request.method === 'GET') {
      scriptHash = url.searchParams.get('hash');
    } else if (context.request.method === 'POST') {
      const body = await context.request.json() as { hash?: string };
      scriptHash = body.hash || null;
    }

    if (!scriptHash || !/^[a-f0-9]{56}$/i.test(scriptHash)) {
      return jsonError('Invalid script hash. Must be 56 hex characters.', 400, corsOrigin);
    }

    const cacheKey = `analysis:v11:${scriptHash}`;  // v11: executionCosts fetched separately

    // Check cache (static analysis only — executionCosts always fetched fresh)
    if (context.env.UPLC_CACHE) {
      const cached = await context.env.UPLC_CACHE.get(cacheKey);
      if (cached) {
        const result = JSON.parse(cached) as AnalysisResult;
        result.cached = true;
        // Always fetch fresh execution stats (has its own 1hr cache)
        const executionStats = await fetchExecutionStats(scriptHash, context.env);
        result.executionCosts = executionStats ?? undefined;
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Cache': 'hit',
            'Cache-Control': 'public, max-age=3600',
            ...corsHeaders(corsOrigin),
          },
        });
      }
    }

    // Fetch script CBOR (Blockfrost preferred, Koios fallback)
    const scriptResult = await fetchScript(scriptHash, context.env);
    if ('error' in scriptResult) {
      return jsonError(scriptResult.error, scriptResult.status, corsOrigin);
    }

    const { type: scriptType, size: scriptSize, bytes: scriptBytes } = scriptResult;

    // Decode, analyze, and estimate cost (+ fetch actual execution stats in parallel)
    const decoded = decodeAndAnalyze(scriptBytes);

    // Collect 56-char hex candidates for script hash verification
    const hashCandidates = [
      ...decoded.constants.bytestrings.filter(bs => bs.length === 56),
      ...decoded.analysis.scriptParams.filter(p => /^[a-f0-9]{56}$/i.test(p.value)).map(p => p.value),
    ].filter((v, i, a) => a.indexOf(v) === i); // dedupe

    const [epochCosts, executionStats, verifiedHashes] = await Promise.all([
      fetchEpochCosts(context.env),
      fetchExecutionStats(scriptHash, context.env),
      verifyScriptHashes(hashCandidates, context.env),
    ]);

    // Convert Blockfrost epoch costs to bigint maps for estimateCost
    let cpuCosts: Record<string, bigint> | undefined;
    let memCosts: Record<string, bigint> | undefined;
    let machineCostParams: MachineCostParams | undefined;

    if (epochCosts) {
      cpuCosts = {};
      memCosts = {};
      for (const [name, costs] of Object.entries(epochCosts.builtinCosts)) {
        cpuCosts[name] = BigInt(Math.round(costs.cpu));
        memCosts[name] = BigInt(Math.round(costs.mem));
      }
      machineCostParams = epochCosts.machineCosts;
    }

    const costEstimate = estimateCost(
      decoded.builtins,
      cpuCosts,
      memCosts,
      decoded.stats,
      machineCostParams,
    );
    const costWarnings = getCostWarnings(decoded.builtins);

    const result: AnalysisResult = {
      scriptHash,
      scriptType,
      size: scriptSize,
      bytes: scriptBytes,
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
          builtins: b.builtins,
        })),
        warnings: costWarnings,
      },
      analysis: decoded.analysis,
      executionCosts: executionStats ?? undefined,
      verifiedScriptHashes: verifiedHashes.length > 0 ? verifiedHashes : undefined,
      cached: false,
    };

    // Cache the static analysis (immutable) — execution costs are fetched separately
    if (context.env.UPLC_CACHE) {
      const { executionCosts: _, ...cacheable } = result;
      context.waitUntil(
        context.env.UPLC_CACHE.put(cacheKey, JSON.stringify(cacheable))
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': 'miss',
        'Cache-Control': 'public, max-age=3600',
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
