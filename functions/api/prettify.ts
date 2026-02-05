// Cloudflare Pages Function to prettify UPLC with Anthropic Claude

interface Env {
  ANTHROPIC_API_KEY: string;
}

const SYSTEM_PROMPT = `You are an expert Cardano/Plutus developer. Your task is to convert raw UPLC (Untyped Plutus Language Core) AST into readable Aiken-style pseudocode.

Guidelines:
- Rename variables like i_0, i_1 to meaningful names (datum, redeemer, ctx, value, pkh, etc.)
- Add comments explaining the logic
- Use Aiken-style syntax (validator, fn, let, if/else, match)
- Add type annotations where inferrable (ByteArray, Int, List<a>, etc.)
- Identify common patterns (signature checks, deadline checks, value transfers)
- Structure as a proper validator when applicable
- Keep the output concise but readable

Output ONLY the prettified code with comments. Do NOT wrap the output in markdown code fences (\`\`\`). Just output the raw code directly.`;

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { ANTHROPIC_API_KEY } = context.env;
  
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { uplc } = await context.request.json() as { uplc: string };
    
    if (!uplc || typeof uplc !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing UPLC code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Truncate if too long (Claude has context limits)
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
        messages: [
          {
            role: 'user',
            content: `Convert this UPLC to readable Aiken-style pseudocode:\n\n\`\`\`\n${truncatedUplc}\n\`\`\``,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', errorText);
      return new Response(JSON.stringify({ error: 'AI service error' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
    };
    
    const aikenCode = data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return new Response(JSON.stringify({ aiken: aikenCode }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    console.error('Prettify error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
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
