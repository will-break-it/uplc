// Cloudflare Pages Function for AI-powered UPLC decompilation
// Returns valid, compilable Aiken code

interface Env {
  ANTHROPIC_API_KEY: string;
  UPLC_CACHE: KVNamespace;
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

interface AnalysisResult {
  aiken: string;
  mermaid?: string;
  cached?: boolean;
}

const DECOMPILE_PROMPT = `You are an expert UPLC reverse engineer. Your task is to decompile UPLC bytecode into valid, compilable Aiken source code.

CRITICAL RULES:
1. OUTPUT MUST BE VALID AIKEN that compiles with the Aiken compiler
2. TRACE THE ACTUAL UPLC - do not guess or invent logic
3. Include type definitions inline (Datum, Redeemer types at top of file)
4. Use proper Aiken syntax, not raw UPLC builtins

AIKEN SYNTAX REFERENCE:
- Comparisons: == != < > <= >= (NOT equalsInteger, lessThanInteger)
- Arithmetic: + - * / % (NOT addInteger, multiplyInteger)
- Boolean: && || ! (NOT andBool, ifThenElse)
- Pattern match: when x is { Variant1 -> ... Variant2 { field } -> ... }
- Conditionals: if cond { ... } else { ... }
- List ops: list.has(), list.any(), list.filter(), list.map(), list.foldl()
- Expect: expect Some(x) = option_value

UPLC PATTERN RECOGNITION:
- (lam x (lam y (lam z body))) = validator with datum/redeemer/ctx
- (force (builtin ifThenElse) cond t f) = if cond { t } else { f }
- (builtin equalsInteger a b) = a == b
- (builtin lessThanInteger a b) = a < b
- (builtin addInteger a b) = a + b
- (builtin multiplyInteger a b) = a * b
- (builtin divideInteger a b) = a / b
- (builtin appendByteString a b) = bytearray.concat(a, b)
- (builtin equalsByteString a b) = a == b
- (builtin sha2_256 x) = crypto.sha256(x)
- (builtin verifyEd25519Signature pk msg sig) = crypto.verify_signature(pk, msg, sig)
- unConstrData + fstPair/sndPair = pattern matching on constructor
- headList/tailList chains = field access on constructor

STRUCTURE YOUR OUTPUT:
\`\`\`aiken
use aiken/collection/list
use cardano/transaction.{Transaction, OutputReference}
// ... other imports as needed

// Datum type (infer from how it's destructured)
type Datum {
  field1: Type,
  field2: Type,
}

// Redeemer type (infer from constructor matching)
type Redeemer {
  Variant1
  Variant2 { arg: Type }
}

validator contract_name {
  spend(datum: Option<Datum>, redeemer: Redeemer, _ref: OutputReference, tx: Transaction) {
    expect Some(d) = datum
    when redeemer is {
      Variant1 -> { ... }
      Variant2 { arg } -> { ... }
    }
  }
}
\`\`\`

DECOMPILATION STRATEGY:
1. First, identify the validator entry point (outermost lambdas)
2. Find redeemer pattern matching (unConstrData + fstPair checks)
3. Count constructor cases to determine redeemer variants
4. Trace each branch to understand the validation logic
5. Identify datum field access patterns
6. Name variables based on how they're used (e.g., if compared to tx.extra_signatories, call it "owner")

FORBIDDEN:
- Do NOT invent logic that isn't in the UPLC
- Do NOT use raw UPLC builtins (equalsInteger, ifThenElse, etc.)
- Do NOT write placeholder comments like "// implementation here"
- Do NOT guess what the contract "probably does"

OUTPUT FORMAT:
Return JSON only: {"aiken": "// complete aiken source code", "mermaid": "flowchart TD\\n..."}

The mermaid diagram should show the validation flow (max 12 nodes).`;

async function callAnthropicWithThinking(
  apiKey: string,
  prompt: string,
  uplc: string,
  thinkingBudget: number = 16000
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 16000,
      thinking: {
        type: 'enabled',
        budget_tokens: thinkingBudget,
      },
      messages: [
        { 
          role: 'user', 
          content: `${prompt}\n\n<uplc_bytecode>\n${uplc}\n</uplc_bytecode>\n\nDecompile this UPLC to valid Aiken. Trace the actual bytecode patterns - do not guess. Return JSON only.`
        }
      ],
    }),
  });

  if (!response.ok) {
    if (response.status === 429 || response.status === 529) {
      throw new Error('RATE_LIMIT');
    }
    const errText = await response.text();
    console.error('Anthropic API error:', errText);
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text?: string }> };
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

function parseJsonSafe<T>(text: string): T | null {
  try {
    // Try to find JSON in the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  } catch {
    return null;
  }
}

function compactUplc(uplc: string, maxLen: number = 100000): string {
  // More aggressive compaction
  const compact = uplc
    .replace(/\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
    .trim();
  
  if (compact.length <= maxLen) return compact;
  
  // If still too long, truncate with marker
  return compact.slice(0, maxLen) + ' [TRUNCATED - contract continues]';
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { ANTHROPIC_API_KEY, UPLC_CACHE } = context.env;
  const corsOrigin = getCorsOrigin(context.request);
  
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
    });
  }

  try {
    const { uplc, scriptHash } = await context.request.json() as { uplc: string; scriptHash?: string };
    
    if (!uplc || typeof uplc !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing UPLC code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
      });
    }

    // Check cache first
    const cacheKey = scriptHash ? `v2:${scriptHash}` : null;
    if (cacheKey && UPLC_CACHE) {
      const cached = await UPLC_CACHE.get(cacheKey);
      if (cached) {
        const parsed = parseJsonSafe<AnalysisResult>(cached);
        if (parsed?.aiken && parsed.aiken.length > 100) {
          return new Response(JSON.stringify({ ...parsed, cached: true }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
          });
        }
      }
    }

    // Compact the UPLC for the prompt
    const compactedUplc = compactUplc(uplc);
    
    // Log size for debugging
    console.log(`UPLC size: ${uplc.length} -> ${compactedUplc.length} (compacted)`);

    // Call Claude with extended thinking
    const rawResponse = await callAnthropicWithThinking(
      ANTHROPIC_API_KEY,
      DECOMPILE_PROMPT,
      compactedUplc,
      16000  // 16k thinking tokens
    );
    
    const parsed = parseJsonSafe<{ aiken?: string; mermaid?: string }>(rawResponse);
    
    if (!parsed?.aiken || parsed.aiken.length < 50) {
      console.error('Failed to parse response:', rawResponse.slice(0, 500));
      return new Response(JSON.stringify({ error: 'Decompilation failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
      });
    }

    const result: AnalysisResult = {
      aiken: parsed.aiken,
      mermaid: parsed.mermaid,
    };

    // Cache successful result
    if (cacheKey && UPLC_CACHE) {
      context.waitUntil(UPLC_CACHE.put(cacheKey, JSON.stringify(result)));
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
    });
  } catch (err) {
    console.error('Analyze error:', err);
    const isRateLimit = err instanceof Error && err.message === 'RATE_LIMIT';
    return new Response(JSON.stringify({ 
      error: isRateLimit ? 'BUDGET_EXHAUSTED' : 'Analysis failed'
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
