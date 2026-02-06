// Cloudflare Pages Function for Mermaid diagram generation
// Takes Aiken code as input, returns flowchart

interface Env {
  ANTHROPIC_API_KEY: string;
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
  return 'https://uplc.wtf';
}

const MERMAID_PROMPT = `You create Mermaid flowcharts from Aiken smart contract code.

RULES:
- Use flowchart TD (top-down)
- Show the validation logic flow
- Include decision nodes for pattern matching (redeemer variants)
- Show key checks (signatures, deadlines, amounts)
- Maximum 12 nodes for readability
- Use clear, short labels
- Escape special characters

STRUCTURE:
- Start with entry point
- Branch on redeemer variants
- Show validation checks as decision diamonds
- End with True/False outcomes

EXAMPLE:
flowchart TD
  A[spend] --> B{Redeemer}
  B -->|Cancel| C{Owner signed?}
  B -->|Execute| D{Deadline passed?}
  C -->|Yes| E[✓ True]
  C -->|No| F[✗ False]
  D -->|Yes| G{Amount valid?}
  D -->|No| F
  G -->|Yes| E
  G -->|No| F

Return JSON only: {"mermaid": "flowchart TD\\n..."}`;

async function callAnthropic(apiKey: string, aiken: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: MERMAID_PROMPT,
      messages: [
        { 
          role: 'user', 
          content: `Create a Mermaid flowchart for this Aiken validator:\n\n${aiken.slice(0, 8000)}`
        },
        {
          role: 'assistant',
          content: '{"mermaid": "'
        }
      ],
    }),
  });

  if (!response.ok) {
    if (response.status === 429 || response.status === 529) {
      throw new Error('RATE_LIMIT');
    }
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text?: string }> };
  return '{"mermaid": "' + data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { ANTHROPIC_API_KEY } = context.env;
  const corsOrigin = getCorsOrigin(context.request);
  
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
    });
  }

  try {
    const { aiken } = await context.request.json() as { aiken: string };
    
    if (!aiken || typeof aiken !== 'string' || aiken.length < 50) {
      return new Response(JSON.stringify({ error: 'Missing or invalid Aiken code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
      });
    }

    const rawResponse = await callAnthropic(ANTHROPIC_API_KEY, aiken);
    
    // Parse the response
    try {
      const parsed = JSON.parse(rawResponse);
      if (parsed?.mermaid) {
        return new Response(JSON.stringify({ mermaid: parsed.mermaid }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
        });
      }
    } catch {
      // Try to extract mermaid from malformed JSON
      const match = rawResponse.match(/"mermaid":\s*"([^"]+)"/);
      if (match) {
        return new Response(JSON.stringify({ mermaid: match[1] }), {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Failed to generate diagram' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
    });
  } catch (err) {
    console.error('Mermaid error:', err);
    const isRateLimit = err instanceof Error && err.message === 'RATE_LIMIT';
    return new Response(JSON.stringify({ 
      error: isRateLimit ? 'BUDGET_EXHAUSTED' : 'Generation failed'
    }), {
      status: isRateLimit ? 429 : 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
    });
  }
};

export const onRequestOptions: PagesFunction<Env> = async (context) => {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': getCorsOrigin(context.request),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};
