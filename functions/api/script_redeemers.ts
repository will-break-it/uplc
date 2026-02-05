// Cloudflare Pages Function to proxy Koios script_redeemers API

interface Env {}

export const onRequest: PagesFunction<Env> = async (context) => {
  // Handle CORS preflight
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    let scriptHash: string | null = null;
    
    // Support both GET (query params) and POST (body)
    if (context.request.method === 'GET') {
      const url = new URL(context.request.url);
      scriptHash = url.searchParams.get('_script_hash');
    } else if (context.request.method === 'POST') {
      const body = await context.request.json() as { _script_hash?: string };
      scriptHash = body._script_hash || null;
    }

    if (!scriptHash) {
      return new Response(JSON.stringify({ error: 'Missing _script_hash parameter' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const response = await fetch('https://api.koios.rest/api/v1/script_redeemers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _script_hash: scriptHash }),
    });

    if (!response.ok) {
      return new Response(JSON.stringify({ error: `Koios API error: ${response.status}` }), {
        status: response.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
};
