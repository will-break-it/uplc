// Cloudflare Pages Function to proxy Koios script_redeemers API
export const onRequestGet: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  const scriptHash = url.searchParams.get('_script_hash');
  const limit = url.searchParams.get('limit') || '10';
  
  if (!scriptHash) {
    return new Response(JSON.stringify({ error: 'Missing _script_hash' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  const koiosUrl = `https://api.koios.rest/api/v1/script_redeemers?_script_hash=${scriptHash}&limit=${limit}`;
  
  const response = await fetch(koiosUrl, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  
  const data = await response.json();
  
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
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
