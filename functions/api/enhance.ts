/**
 * Cloudflare Function - AI Enhancement Endpoint
 *
 * Provides AI-powered enhancements:
 * 1. Semantic variable naming
 * 2. Code annotations
 * 3. Architecture diagram generation (Mermaid)
 */

export interface Env {
  ANTHROPIC_API_KEY: string;
  UPLC_CACHE: KVNamespace;
}

export interface EnhanceRequest {
  scriptHash: string;
  aikenCode: string;
  uplcPreview: string;
  purpose: string;
  builtins: Record<string, number>;
  traces: string[];
  enhance: ('naming' | 'annotations' | 'diagram' | 'rewrite')[];
}

export interface EnhanceResponse {
  naming?: Record<string, string>;
  annotations?: string[];
  diagram?: string;
  rewrite?: string;
  cached?: boolean;
  error?: string;
}

export interface EnhancementInput {
  aikenCode: string;
  purpose: string;
  builtins: Record<string, number>;
  traces: string[];
}

const ALLOWED_ORIGINS = [
  'https://uplc.wtf',
  'https://www.uplc.wtf',
  'https://uplc.pages.dev',
  'http://localhost:4321'
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
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (context.request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': corsOrigin,
      },
    });
  }

  try {
    const body = await context.request.json() as EnhanceRequest;

    if (!body.scriptHash || !body.aikenCode || !body.enhance || body.enhance.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': corsOrigin,
        },
      });
    }

    const result: EnhanceResponse = {};

    // Check cache first
    const cacheKey = `enhance:${body.scriptHash}:${body.enhance.join(',')}`;
    const cached = await context.env.UPLC_CACHE.get(cacheKey, 'json');

    if (cached) {
      return new Response(JSON.stringify({ ...cached, cached: true }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': corsOrigin,
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // Process enhancements
    for (const enhance of body.enhance) {
      const input: EnhancementInput = {
        aikenCode: body.aikenCode,
        purpose: body.purpose,
        builtins: body.builtins,
        traces: body.traces || [],
      };

      switch (enhance) {
        case 'naming':
          result.naming = await enhanceNaming(input, context.env);
          break;
        case 'annotations':
          result.annotations = await enhanceAnnotations(input, context.env);
          break;
        case 'diagram':
          result.diagram = await generateDiagram(input, context.env);
          break;
        case 'rewrite':
          result.rewrite = await rewriteCode(input, context.env);
          break;
      }
    }

    // Cache result for 1 hour
    await context.env.UPLC_CACHE.put(cacheKey, JSON.stringify(result), {
      expirationTtl: 3600,
    });

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': corsOrigin,
        'Cache-Control': 'public, max-age=3600',
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

/**
 * Enhance variable naming using AI
 */
export async function enhanceNaming(input: EnhancementInput, env: Env): Promise<Record<string, string>> {
  const prompt = `You are analyzing a decompiled Cardano Plutus smart contract. The contract has been reverse-engineered from UPLC bytecode to Aiken-style code.

Contract Purpose: ${input.purpose}
Top Builtins: ${Object.entries(input.builtins).slice(0, 10).map(([k, v]) => `${k}: ${v}`).join(', ')}

Current Aiken Code:
\`\`\`aiken
${input.aikenCode}
\`\`\`

Task: Suggest better semantic variable names for the generic names in the code (like i_0, i_1, datum_field, etc.).

Rules:
1. Base names on how the variable is used in the code
2. Use Cardano/DeFi domain knowledge (owner, deadline, amount, signer, token_name, policy_id, etc.)
3. Keep names concise (1-2 words, snake_case)
4. Only suggest renames for variables that currently have generic names

Respond with a JSON object mapping old names to new names:
{"old_name": "new_name", ...}`;

  const response = await callClaude(prompt, env);

  try {
    return JSON.parse(response);
  } catch {
    // Fallback: extract JSON from response
    const match = response.match(/\{[^}]+\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    return {};
  }
}

/**
 * Generate code annotations using AI
 */
export async function enhanceAnnotations(input: EnhancementInput, env: Env): Promise<string[]> {
  const prompt = `You are analyzing a decompiled Cardano Plutus smart contract.

Contract Purpose: ${input.purpose}

Aiken Code:
\`\`\`aiken
${input.aikenCode}
\`\`\`

Task: Generate concise inline comments explaining what each validator check does.

Rules:
1. One comment per validation check
2. Explain the "why" not the "what"
3. Use Cardano-specific terminology
4. Keep comments under 60 characters

Respond with a JSON array of comments:
["// Comment 1", "// Comment 2", ...]`;

  const response = await callClaude(prompt, env);

  try {
    return JSON.parse(response);
  } catch {
    // Fallback: extract array from response
    const match = response.match(/\[[^\]]+\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
    return [];
  }
}

/**
 * Generate architecture diagram using AI
 */
export async function generateDiagram(input: EnhancementInput, env: Env): Promise<string> {
  const prompt = `You are generating a Mermaid architecture diagram for a decompiled Cardano Plutus smart contract.

Contract Purpose: ${input.purpose}
Top Builtins: ${Object.entries(input.builtins).slice(0, 15).map(([k, v]) => `${k}: ${v}`).join(', ')}

Aiken Code:
\`\`\`aiken
${input.aikenCode.slice(0, 2000)}${input.aikenCode.length > 2000 ? '...' : ''}
\`\`\`

Task: Generate a Mermaid flowchart showing the validator's architecture:
1. Start with datum/redeemer inputs
2. Show main validation branches (when expressions)
3. Show key validation checks (signature, deadline, value, etc.)
4. End with success/failure outcomes

Rules:
1. Use "flowchart TD" format
2. Keep it simple and readable (max 15 nodes)
3. Use descriptive node labels
4. Group related checks in subgraphs if applicable
5. Use proper Mermaid syntax

Respond with ONLY the Mermaid code (no markdown fences):`;

  const response = await callClaude(prompt, env);

  // Clean up response - remove markdown fences if present
  let diagram = response.trim();
  diagram = diagram.replace(/^```mermaid\n?/gm, '');
  diagram = diagram.replace(/^```\n?/gm, '');
  diagram = diagram.trim();

  // Ensure it starts with flowchart
  if (!diagram.startsWith('flowchart') && !diagram.startsWith('graph')) {
    diagram = 'flowchart TD\n' + diagram;
  }

  return diagram;
}

/**
 * Rewrite code into clean, idiomatic Aiken
 */
export async function rewriteCode(input: EnhancementInput, env: Env): Promise<string> {
  const tracesSection = input.traces.length > 0
    ? `\nTRACE STRINGS (from bytecode - MUST include ALL of these):\n${input.traces.map(t => `- "${t}"`).join('\n')}\n`
    : '';

  const prompt = `You are an expert Aiken developer transforming decompiled Plutus bytecode into clean, readable Aiken code.

CONTRACT TYPE: ${input.purpose} validator
BUILTINS USED: ${Object.entries(input.builtins).slice(0, 20).map(([k, v]) => `${k}(${v})`).join(', ')}${tracesSection}
DECOMPILED CODE:
\`\`\`
${input.aikenCode}
\`\`\`

YOUR TASK:
Transform this into human-readable Aiken that a developer would write. Focus on:

1. MEANINGFUL NAMES - Infer purpose from usage:
   - Variables accessing tx.extra_signatories → required_signer, authorized_key
   - Variables compared with deadlines → deadline, valid_until, lock_time
   - Variables from datum fields → owner, beneficiary, amount, token_policy
   - Loop/recursion counters → index, count, remaining
   - ByteArrays used in signatures → pubkey_hash, signature
   - Integers used in comparisons → threshold, min_amount, deadline
   
2. TYPE DEFINITIONS - Create types when structure is clear:
   - Datum with multiple fields → type Datum { field1: Type, field2: Type }
   - Redeemer with constructor checks → type Action { Claim, Cancel, Update }
   - Don't invent types you can't justify from the code
   
3. HELPER FUNCTIONS - Extract repeated patterns:
   - Repeated field access → named function
   - Common validation → expect_* or check_* function
   
4. AIKEN IDIOMS:
   - when/is for constructor matching (not nested if/else on .1st)
   - expect for fallible destructuring
   - list.has, list.find, list.filter for list operations
   - Proper pipe operators |>

5. PRESERVE:
   - ALL trace strings exactly as written
   - ALL validation logic (do not remove checks)
   - Functional correctness (equivalent behavior)

6. STRUCTURE:
   - Put type definitions at the top
   - Put helper functions before the validator
   - Keep the validator body clean and readable

OUTPUT FORMAT:
Return ONLY valid Aiken code. No markdown fences, no explanations, no comments unless they clarify complex logic.

Example transformation:
BAD:  let cbA = fn(x) { if builtin.un_constr_data(x).1st == 0 { ... } }
GOOD: fn expect_datum(data: Data) -> Datum { expect datum: Datum = data; datum }`;

  // Use higher token limit for complex contracts
  const response = await callClaude(prompt, env, 8192);

  // Clean up response
  let code = response.trim();
  code = code.replace(/^```aiken\n?/gm, '');
  code = code.replace(/^```\n?/gm, '');
  code = code.trim();

  return code;
}

/**
 * Call AI API
 */
export async function callClaude(prompt: string, env: Env, maxTokens: number = 2048): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-20250514',
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`AI enhancement error: ${response.status} - ${errorBody}`);
  }

  const data = await response.json() as any;
  return data.content[0]?.text || '';
}
