// Cloudflare Pages Function to proxy Koios script_info API with caching
// 
// Cache layers:
// - UPLC_CACHE KV: script:{hash} → CBOR bytes (immutable, never expires)
// - Script data is immutable on-chain, so we cache forever

interface Env {
  UPLC_CACHE?: KVNamespace;
}

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://uplc.wtf',
  'https://www.uplc.wtf',
  'https://uplc.pages.dev',
];

function getCorsOrigin(request: Request): string {
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }
  // Allow localhost for development
  if (origin.startsWith('http://localhost:')) {
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

interface ScriptInfo {
  script_hash: string;
  creation_tx_hash: string;
  type: string;
  value: any;
  bytes: string;
  size: number;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const corsOrigin = getCorsOrigin(context.request);
  
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders(corsOrigin) });
  }

  try {
    let scriptHashes: string[] = [];
    
    if (context.request.method === 'GET') {
      const url = new URL(context.request.url);
      const hash = url.searchParams.get('_script_hashes');
      if (hash) scriptHashes = [hash];
    } else if (context.request.method === 'POST') {
      const body = await context.request.json() as { _script_hashes?: string[] };
      scriptHashes = body._script_hashes || [];
    }

    if (scriptHashes.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing _script_hashes parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(corsOrigin) },
      });
    }

    const results: ScriptInfo[] = [];
    const uncached: string[] = [];

    // Check cache first (if KV is available)
    if (context.env.UPLC_CACHE) {
      for (const hash of scriptHashes) {
        const cached = await context.env.UPLC_CACHE.get(`script:${hash}`, 'json') as ScriptInfo | null;
        if (cached) {
          results.push(cached);
        } else {
          uncached.push(hash);
        }
      }
    } else {
      // No KV binding, fetch all from Koios
      uncached.push(...scriptHashes);
    }

    // Fetch uncached scripts from Koios
    if (uncached.length > 0) {
      const response = await fetch('https://api.koios.rest/api/v1/script_info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _script_hashes: uncached }),
      });

      if (!response.ok) {
        // If we have some cached results, return those
        if (results.length > 0) {
          return new Response(JSON.stringify(results), {
            headers: { 
              'Content-Type': 'application/json',
              'X-Cache': 'partial',
              ...corsHeaders(corsOrigin) 
            },
          });
        }
        return new Response(JSON.stringify({ error: `Koios API error: ${response.status}` }), {
          status: response.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(corsOrigin) },
        });
      }

      const freshData = await response.json() as ScriptInfo[];
      
      // Cache the fresh data (script data is immutable, cache forever)
      if (context.env.UPLC_CACHE) {
        for (const script of freshData) {
          if (script.script_hash && script.bytes) {
            // Don't await - fire and forget for speed
            context.waitUntil(
              context.env.UPLC_CACHE.put(
                `script:${script.script_hash}`,
                JSON.stringify(script)
                // No expiration - script data is immutable
              )
            );
          }
        }
      }
      
      results.push(...freshData);
    }

    // Determine cache status for response header
    const cacheStatus = uncached.length === 0 ? 'hit' : 
                        results.length > uncached.length ? 'partial' : 'miss';

    return new Response(JSON.stringify(results), {
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': cacheStatus,
        'Cache-Control': 'public, max-age=31536000, immutable', // Browser cache 1 year
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
