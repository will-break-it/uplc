// Cloudflare Pages Function to prettify UPLC with Anthropic Claude + KV cache

interface Env {
  ANTHROPIC_API_KEY: string;
  UPLC_CACHE: KVNamespace;
}

const SYSTEM_PROMPT = `You are a Cardano/Plutus decompiler. Convert UPLC AST into Aiken-style pseudocode.

RESPOND WITH JSON ONLY in this exact format:
{"code": "...aiken code here..."}

OR if the UPLC is truncated/incomplete and you cannot decompile:
{"error": "brief reason"}

DECOMPILATION RULES:
1. Actually decompile - don't describe, show real logic
2. Follow every lambda, application, builtin call
3. Trace data flow from datum/redeemer/ctx
4. Show actual conditions and comparisons
5. NO placeholders like "True" or "validation logic here"
6. NO meta-commentary like "this appears to be"

Aiken syntax:
- validator name(p1, p2)(datum: Data, redeemer: Data, ctx: ScriptContext) -> Bool
- let x = expr
- if condition { ... } else { ... }
- when expr is { Pattern -> result }

Recognize patterns:
- EqualsData + HeadList/TailList = field access
- VerifyEd25519Signature = signature check
- LessThanEqualsInteger + POSIXTime = deadline check
- UnConstrData 0/1 = True/False

If UPLC shows only lambdas without body (truncated), return error.
Output valid JSON only. No markdown.`;

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
        // Check if cached value is an error
        try {
          const parsed = JSON.parse(cached);
          if (parsed.error) {
            // Don't return cached errors, try again
          } else {
            return new Response(JSON.stringify({ aiken: parsed.code || cached, cached: true }), {
              headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
            });
          }
        } catch {
          // Old cache format (raw code string)
          return new Response(JSON.stringify({ aiken: cached, cached: true }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }
      }
    }

    // Compact whitespace to save tokens
    const compactUplc = uplc
      .replace(/\n\s+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Truncate if too long (but note this in the prompt context)
    const isTruncated = compactUplc.length > 100000;
    const truncatedUplc = isTruncated 
      ? compactUplc.slice(0, 100000) + ' [TRUNCATED - more code exists]' 
      : compactUplc;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-20250514',
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [
          { role: 'user', content: `Decompile this UPLC to Aiken. Respond with JSON only:\n\n${truncatedUplc}` },
          { role: 'assistant', content: '{' }  // Prefill to force JSON
        ],
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
    const rawResponse = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    
    // Parse the JSON response (prepend the { we prefilled)
    let result: { code?: string; error?: string };
    try {
      result = JSON.parse('{' + rawResponse);
    } catch {
      // If JSON parsing fails, treat raw response as code
      result = { code: rawResponse };
    }

    // Check if it's an error response
    if (result.error) {
      return new Response(JSON.stringify({ error: result.error }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const aikenCode = result.code || '';
    
    // Only cache successful code responses
    if (cacheKey && UPLC_CACHE && aikenCode && aikenCode.length > 50) {
      context.waitUntil(UPLC_CACHE.put(cacheKey, JSON.stringify({ code: aikenCode })));
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
