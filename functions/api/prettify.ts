// Cloudflare Pages Function to prettify UPLC with Anthropic Claude + KV cache

interface Env {
  ANTHROPIC_API_KEY: string;
  UPLC_CACHE: KVNamespace;
}

const SYSTEM_PROMPT = `You are an expert Cardano/Plutus developer. Convert raw UPLC AST into readable Aiken-style pseudocode.

Guidelines:
- Rename variables (i_0 → datum, redeemer, ctx, value, pkh, etc.)
- Add comments explaining logic
- Use Aiken syntax (validator, fn, let, if/else, match)
- Add type annotations where inferrable
- Identify common patterns (signature checks, deadlines, transfers)
- Keep output concise but readable

Output ONLY the prettified code. No markdown fences.`;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { ANTHROPIC_API_KEY, UPLC_CACHE } = context.env;
  
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  try {
    const { uplc, scriptHash } = await context.request.json() as { uplc: string; scriptHash?: string };
    
    if (!uplc || typeof uplc !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing UPLC code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Check cache if scriptHash provided and KV available
    const cacheKey = scriptHash ? `aiken:${scriptHash}` : null;
    if (cacheKey && UPLC_CACHE) {
      const cached = await UPLC_CACHE.get(cacheKey);
      if (cached) {
        return new Response(JSON.stringify({ aiken: cached, cached: true }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    }

    // Truncate if too long
    const truncatedUplc = uplc.length > 50000 ? uplc.slice(0, 50000) + '\n... [truncated]' : uplc;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Convert this UPLC to Aiken-style pseudocode:\n\n${truncatedUplc}` }],
      }),
    });

    if (!response.ok) {
      console.error('Anthropic API error:', await response.text());
      return new Response(JSON.stringify({ error: 'AI service error' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const data = await response.json() as { content: Array<{ type: string; text?: string }> };
    const aikenCode = data.content.filter(b => b.type === 'text').map(b => b.text).join('');

    // Cache result (no expiration - script bytecode never changes)
    if (cacheKey && UPLC_CACHE && aikenCode) {
      context.waitUntil(UPLC_CACHE.put(cacheKey, aikenCode));
    }

    return new Response(JSON.stringify({ aiken: aikenCode }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    console.error('Prettify error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
