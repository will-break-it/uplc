// Cloudflare Pages Function to prettify UPLC with Anthropic Claude + KV cache

interface Env {
  ANTHROPIC_API_KEY: string;
  UPLC_CACHE: KVNamespace;
}

const SYSTEM_PROMPT = `You are an expert Cardano/Plutus decompiler. Convert UPLC AST into actual Aiken-style code.

CRITICAL RULES:
1. ACTUALLY DECOMPILE - don't describe structure, show the real logic
2. Follow every lambda, every application, every builtin call
3. Trace data flow: what gets extracted from datum/redeemer/ctx?
4. Show actual conditions: what builtins are called? what comparisons?
5. NO PLACEHOLDERS - never write "True", "validation logic here", etc.
6. NO META-COMMENTARY - don't say "this appears to be" or "likely"

Aiken syntax guide:
- validator name(datum: Type, redeemer: Type, ctx: ScriptContext) -> Bool
- let x = expr
- if condition { ... } else { ... }
- when expr is { Pattern -> result, ... }
- list.any(), list.find(), etc. for list operations

For parameterized validators (curried lambdas):
- First N lambdas are compile-time parameters, show as: validator name(p1, p2, ...)(datum, redeemer, ctx)
- Name parameters based on usage (policy_id, deadline, owner_pkh, etc.)

Common patterns to recognize:
- EqualsData + HeadList/TailList = field access
- VerifyEd25519Signature = signature check  
- LessThanEqualsInteger on POSIXTime = deadline check
- UnConstrData index 0/1 = True/False or custom constructor

Output ONLY working Aiken-style code with comments. No markdown.`;

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

    // Compact whitespace to save tokens (indentation not semantically meaningful)
    const compactUplc = uplc
      .replace(/\n\s+/g, ' ')  // Replace newline+indent with single space
      .replace(/\s+/g, ' ')     // Collapse multiple spaces
      .trim();
    
    // Truncate if too long
    const truncatedUplc = compactUplc.length > 80000 ? compactUplc.slice(0, 80000) + ' ... [truncated]' : compactUplc;

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
