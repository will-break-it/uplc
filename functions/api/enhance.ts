/**
 * Cloudflare Function - AI Enhancement Endpoint
 *
 * Provides AI-powered enhancements:
 * 1. Semantic variable naming
 * 2. Code annotations
 * 3. Architecture diagram generation (Mermaid)
 */

import { verifyCode, type VerificationResult } from '@uplc/codegen';

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
  constants?: { bytestrings?: string[]; integers?: string[] };
  enhance: ('naming' | 'annotations' | 'diagram' | 'rewrite')[];
  retry?: boolean;
}

export interface EnhanceResponse {
  naming?: Record<string, string>;
  annotations?: string[];
  diagram?: string;
  rewrite?: string;
  verification?: {
    confidence: 'high' | 'medium' | 'low';
    constantScore: number;
    referenceScore: number;
    placeholderScore: number;
    abstractionScore: number;
    missingConstants: string[];
    undefinedFunctions: string[];
    placeholders: string[];
    builtinDensity: number;
    totalConstants: number;
    foundConstants: number;
    issues: string[];
  };
  cached?: boolean;
  error?: string;
}

export interface EnhancementInput {
  aikenCode: string;
  purpose: string;
  builtins: Record<string, number>;
  traces: string[];
  constants?: { bytestrings?: string[]; integers?: string[] };
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

    // Check cache first (skip if retry=true)
    const cacheKey = `enhance:${body.scriptHash}:${body.enhance.join(',')}`;
    if (!body.retry) {
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
    }

    // Process enhancements
    for (const enhance of body.enhance) {
      const input: EnhancementInput = {
        aikenCode: body.aikenCode,
        purpose: body.purpose,
        builtins: body.builtins,
        traces: body.traces || [],
        constants: body.constants,
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
          // Verify the rewritten code quality
          if (result.rewrite && input.constants) {
            const verification = verifyCode(
              result.rewrite,
              { bytestrings: input.constants.bytestrings || [], integers: input.constants.integers || [] },
              input.traces || []
            );
            result.verification = {
              confidence: verification.confidence,
              constantScore: verification.constantScore,
              referenceScore: verification.referenceScore,
              placeholderScore: verification.placeholderScore,
              abstractionScore: verification.abstractionScore,
              missingConstants: verification.missingConstants,
              undefinedFunctions: verification.undefinedFunctions,
              placeholders: verification.placeholders,
              builtinDensity: verification.builtinDensity,
              totalConstants: verification.totalConstants,
              foundConstants: verification.foundConstants,
              issues: verification.issues,
            };
          }
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

  // Decode hex bytestrings to ASCII where possible for context
  const hexToAscii = (hex: string): string | null => {
    let result = '';
    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.substring(i, i + 2), 16);
      if (byte < 32 || byte > 126) return null;
      result += String.fromCharCode(byte);
    }
    return result.length >= 2 ? result : null;
  };

  let constantsSection = '';
  if (input.constants) {
    const parts: string[] = [];
    if (input.constants.bytestrings?.length) {
      parts.push('BYTESTRING CONSTANTS (extracted from bytecode):');
      for (const bs of input.constants.bytestrings.slice(0, 15)) {
        const decoded = hexToAscii(bs);
        parts.push(`- #"${bs}"${decoded ? ` (= "${decoded}")` : ''} [${bs.length / 2} bytes]`);
      }
    }
    if (input.constants.integers?.length) {
      const notable = input.constants.integers.filter(i => parseInt(i) > 1 || parseInt(i) < 0);
      if (notable.length) {
        parts.push(`NOTABLE INTEGERS: ${notable.join(', ')}`);
      }
    }
    if (parts.length) constantsSection = '\n' + parts.join('\n') + '\n';
  }

  const prompt = `You are rewriting decompiled Plutus bytecode into cleaner Aiken. You MUST preserve all logic exactly - this is for security auditing.

CONTRACT TYPE: ${input.purpose} validator
BUILTINS USED: ${Object.entries(input.builtins).slice(0, 20).map(([k, v]) => `${k}(${v})`).join(', ')}${tracesSection}${constantsSection}
DECOMPILED CODE:
\`\`\`
${input.aikenCode}
\`\`\`

STRICT RULES:

1. PRESERVE EVERYTHING:
   - ALL bytestring constants (#"...") exactly as they appear
   - ALL integer constants exactly as they appear  
   - ALL trace strings exactly as written
   - ALL conditional checks and comparisons
   - ALL function calls and their arguments
   - The exact control flow structure

2. ONLY RENAME variables to meaningful names based on usage:
   - cbA, cbB → owner, amount, deadline (when clear from context)
   - Variables accessing tx.extra_signatories → signer, required_key
   - Variables with un_b_data → pubkey_hash, token_name, policy_id
   - Keep original names if purpose is unclear

3. SIMPLIFY SYNTAX (not logic):
   - fn(x) { x } applied to arg → just arg (inline identity)
   - if x.1st == 0 { ... } else { fail } → when x is { ... }
   - Nested if/else on same variable → when/is pattern match

4. DO NOT:
   - Remove any constants, checks, or comparisons
   - Simplify or "optimize" the logic
   - Invent validation that isn't there
   - Add helper functions that change behavior
   - Guess what the contract "should" do

5. FORMAT:
   - Keep bytestring constants inline (don't extract to variables)
   - Use Aiken syntax for pattern matching where applicable
   - One statement per line for readability

OUTPUT: Return ONLY the Aiken code. No markdown, no explanations.`;

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
 * Call AI API with automatic fallback from Opus → Sonnet on timeout/error
 */
const PRIMARY_MODEL = 'claude-opus-4-6';
const FALLBACK_MODEL = 'claude-opus-4-6';
const PRIMARY_TIMEOUT_MS = 30_000; // 30s for primary, then fallback

export async function callClaude(prompt: string, env: Env, maxTokens: number = 2048): Promise<string> {
  // Try primary model with timeout
  try {
    const result = await callModel(prompt, env, PRIMARY_MODEL, maxTokens, PRIMARY_TIMEOUT_MS);
    return result;
  } catch (primaryError) {
    // If primary model is same as fallback, just throw
    if (PRIMARY_MODEL === FALLBACK_MODEL) throw primaryError;

    console.log(`Primary model (${PRIMARY_MODEL}) failed: ${primaryError instanceof Error ? primaryError.message : 'unknown'}, falling back to ${FALLBACK_MODEL}`);

    // Fallback — no timeout (Cloudflare will enforce its own limit)
    return callModel(prompt, env, FALLBACK_MODEL, maxTokens);
  }
}

async function callModel(
  prompt: string,
  env: Env,
  model: string,
  maxTokens: number,
  timeoutMs?: number,
): Promise<string> {
  const controller = timeoutMs ? new AbortController() : undefined;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
      signal: controller?.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`AI enhancement error (${model}): ${response.status} - ${errorBody}`);
    }

    const data = await response.json() as any;
    return data.content[0]?.text || '';
  } finally {
    if (timer) clearTimeout(timer);
  }
}
