/**
 * Unified Analysis Endpoint
 *
 * Single endpoint that orchestrates:
 * 1. CBOR fetching from Koios
 * 2. UPLC decoding
 * 3. Decompilation to Aiken
 * 4. AI enhancements (automatic)
 * 5. Unified caching (24h TTL)
 */

import { getGlobalCache, type UnifiedCacheEntry } from '@uplc/cache';
import {
  enhanceNaming,
  enhanceAnnotations,
  generateDiagram,
  type Env as EnhanceEnv,
  type EnhancementInput
} from './enhance';
import { fetchScriptInfo, decodeUPLC, extractErrorMessages, classifyContract } from '../lib/analyzer';
import { decompileUplc } from '../lib/decompiler';

interface Env extends EnhanceEnv {
  ANTHROPIC_API_KEY: string;
  UPLC_CACHE: KVNamespace;
}

interface AnalyzeRequest {
  scriptHash: string;
}

interface AnalyzeResponse {
  // Cache metadata
  cached: boolean;
  version: '1.0';

  // Unified result
  result: UnifiedCacheEntry;
}

const ALLOWED_ORIGINS = [
  'https://uplc.wtf',
  'https://www.uplc.wtf',
  'https://uplc.pages.dev',
  'http://localhost:4321'
];

function getCorsOrigin(request: Request): string {
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }
  return 'https://uplc.wtf';
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const corsOrigin = getCorsOrigin(context.request);

  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': corsOrigin,
      },
    });
  }

  try {
    const body = await context.request.json() as AnalyzeRequest;

    if (!body.scriptHash) {
      return new Response(JSON.stringify({ error: 'Missing scriptHash' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': corsOrigin,
        },
      });
    }

    // Check unified cache
    const cache = getGlobalCache(context.env.UPLC_CACHE);
    const cached = await cache.getUnified(body.scriptHash);

    if (cached) {
      return new Response(JSON.stringify({
        cached: true,
        version: '1.0',
        result: cached,
      } as AnalyzeResponse), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': corsOrigin,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // Cache miss - perform full analysis
    const result = await performFullAnalysis(body.scriptHash, context.env);

    // Store in unified cache
    await cache.setUnified(result);

    return new Response(JSON.stringify({
      cached: false,
      version: '1.0',
      result,
    } as AnalyzeResponse), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': corsOrigin,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': corsOrigin,
      },
    });
  }
};

/**
 * Perform full analysis: fetch, decode, decompile, enhance
 */
async function performFullAnalysis(
  scriptHash: string,
  env: Env
): Promise<UnifiedCacheEntry> {
  // Step 1: Fetch CBOR from Koios
  const scriptInfo = await fetchScriptInfo(scriptHash);
  const cbor = scriptInfo.bytes;

  // Step 2: Decode UPLC bytecode
  const decoded = decodeUPLC(cbor);
  const errorMessages = extractErrorMessages(cbor);

  // Step 3: Classify contract
  const { classification } = classifyContract(
    decoded.builtins,
    errorMessages,
    cbor
  );

  const totalBuiltins = Object.values(decoded.builtins).reduce((a, b) => a + b, 0);

  // Step 4: Decompile to Aiken
  const decompiled = decompileUplc(decoded.prettyPrint);

  // Build unified entry
  const entry: UnifiedCacheEntry = {
    version: '1.0',
    scriptHash,
    timestamp: Date.now(),

    // Raw data
    cbor,
    uplcText: decoded.prettyPrint,
    plutusVersion: decoded.version,
    scriptType: scriptInfo.type || 'plutusV2',
    scriptSize: scriptInfo.size || 0,

    // Analysis
    builtins: decoded.builtins,
    errorMessages,
    constants: decoded.constants,
    classification,
    stats: {
      totalBuiltins,
      uniqueBuiltins: Object.keys(decoded.builtins).length,
      ...decoded.stats,
    },

    // Decompilation
    decompiled: {
      aikenCode: decompiled.aikenCode,
      scriptPurpose: decompiled.scriptPurpose,
      params: decompiled.params,
      datumUsed: decompiled.datumUsed,
      datumFields: decompiled.datumFields,
      redeemerVariants: decompiled.redeemerVariants,
      validationChecks: decompiled.validationChecks,
      error: decompiled.error,
    },

    // AI Enhancements - will be populated below
    enhancements: null,
  };

  // Step 5: AI Enhancement (automatic, in parallel)
  try {
    // Only enhance if decompilation succeeded
    if (!decompiled.error && decompiled.aikenCode && !decompiled.aikenCode.startsWith('//')) {
      const input: EnhancementInput = {
        aikenCode: decompiled.aikenCode,
        purpose: decompiled.scriptPurpose,
        builtins: decoded.builtins,
      };

      const [naming, annotations, diagram] = await Promise.all([
        enhanceNaming(input, env).catch(() => ({})),
        enhanceAnnotations(input, env).catch(() => []),
        generateDiagram(input, env).catch(() => ''),
      ]);

      entry.enhancements = {
        naming,
        annotations,
        diagram,
      };
    }
  } catch (err) {
    // If AI enhancement fails, continue without it
    console.error('AI enhancement failed:', err);
    entry.enhancements = null;
  }

  return entry;
}
