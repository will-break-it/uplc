// Cloudflare Pages Function to get script popularity from cexplorer

interface Env {
  UPLC_CACHE: KVNamespace;
}

interface CexplorerStats {
  totalTxns: number;
  lastActivity: string | null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { UPLC_CACHE } = context.env;
  const url = new URL(context.request.url);
  const scriptHash = url.searchParams.get('hash');

  if (!scriptHash || !/^[a-f0-9]{56}$/i.test(scriptHash)) {
    return new Response(JSON.stringify({ error: 'Invalid script hash' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // Check cache (1 hour TTL)
  const cacheKey = `cex:${scriptHash}`;
  if (UPLC_CACHE) {
    const cached = await UPLC_CACHE.get(cacheKey);
    if (cached) {
      return new Response(cached, {
        headers: { 
          'Content-Type': 'application/json', 
          'Access-Control-Allow-Origin': '*',
          'X-Cache': 'HIT',
        },
      });
    }
  }

  try {
    // Just get count + last activity (minimal data)
    const apiUrl = `https://api-mainnet-stage.cexplorer.io/v1/script/detail_redeemer?hash=${scriptHash}&page=1&perPage=1`;
    
    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'UPLC-Analyzer/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Cexplorer API error: ${response.status}`);
    }

    const data = await response.json() as {
      code: number;
      data: {
        data: Array<{ tx: { time: string } }>;
        count: number;
      };
    };

    if (data.code !== 200 || !data.data) {
      throw new Error('Invalid cexplorer response');
    }

    const stats: CexplorerStats = {
      totalTxns: data.data.count || 0,
      lastActivity: data.data.data?.[0]?.tx?.time || null,
    };

    const resultJson = JSON.stringify(stats);

    // Cache for 1 hour
    if (UPLC_CACHE) {
      context.waitUntil(
        UPLC_CACHE.put(cacheKey, resultJson, { expirationTtl: 3600 })
      );
    }

    return new Response(resultJson, {
      headers: { 
        'Content-Type': 'application/json', 
        'Access-Control-Allow-Origin': '*',
        'X-Cache': 'MISS',
      },
    });
  } catch (err) {
    console.error('Cexplorer proxy error:', err);
    return new Response(JSON.stringify({ error: 'Failed to fetch stats' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
