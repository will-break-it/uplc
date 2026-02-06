// Cloudflare Pages Function to proxy Koios script_info API (avoids CORS)

interface Env {}

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'https://uplc.wtf',
  'https://www.uplc.wtf',
  'https://uplc.pages.dev',
  'http://localhost:4321',
  'http://localhost:3000',
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
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
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
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': corsOrigin,
        },
      });
    }

    const response = await fetch('https://api.koios.rest/api/v1/script_info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _script_hashes: scriptHashes }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `Koios API error: ${response.status}` }), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': corsOrigin,
        },
      });
    }

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': corsOrigin,
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
