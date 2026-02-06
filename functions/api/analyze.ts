// Cloudflare Pages Function for combined AI analysis with retry fallback
// Strategy: Try combined (aiken+mermaid+types) first, on failure split into separate calls

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
  // Reject unknown origins by returning the primary domain
  // (browser will block the response due to CORS mismatch)
  return 'https://uplc.wtf';
}

interface AnalysisResult {
  aiken: string;
  mermaid?: string;
  types?: {
    datum: string;
    redeemer: string;
  };
  cached?: boolean;
}

const COMBINED_PROMPT = `<role>You are an expert Cardano/Aiken developer who reverse-engineers UPLC bytecode into valid, compilable Aiken code.</role>

<task>
Analyze the provided UPLC bytecode and produce:
1. Valid Aiken source code that compiles
2. A Mermaid flowchart showing validation logic
3. Proper Aiken type definitions for Datum and Redeemer
</task>

<output_format>
Respond with valid JSON only (no markdown, no code fences):
{
  "aiken": "// valid aiken code here",
  "mermaid": "flowchart TD\\n  A[Entry] --> B{Redeemer}\\n  ...",
  "types": {
    "datum": "type Datum { field1: Type, field2: Type }",
    "redeemer": "type Redeemer { Variant1 Variant2 { arg: Type } }"
  }
}
</output_format>

<aiken_syntax_rules>
CRITICAL: Output MUST be valid Aiken that compiles. Never use raw UPLC builtins.

CORRECT Aiken syntax:
- Comparisons: == != < > <= >= (NOT equalsInteger, lessThanInteger)
- Arithmetic: + - * / % (NOT addInteger, multiplyInteger, divideInteger)
- Boolean: && || ! (NOT andBool, orBool, not)
- Pattern matching: when x is { Variant1 -> ... Variant2 { field } -> ... }
- Conditionals: if condition { ... } else { ... }
- Lists: list.head, list.tail, list.length, list.map(), list.filter(), list.any()
- ByteArray: bytearray.length(), bytearray.take(), bytearray.drop()
- Option: when opt is { Some(x) -> ... None -> ... }
- String interpolation not supported, use bytearray literals: #"deadbeef"

VALIDATOR STRUCTURE:
validator my_validator {
  spend(datum: Option<Datum>, redeemer: Redeemer, _own_ref: OutputReference, tx: Transaction) {
    expect Some(d) = datum
    // validation logic
    True
  }
}

TYPE DEFINITIONS:
type Datum {
  owner: VerificationKeyHash,
  deadline: Int,
  amount: Int,
}

type Redeemer {
  Cancel
  Claim { signature: ByteArray }
  Swap { amount_in: Int, min_out: Int }
}

PATTERN MATCHING on redeemer:
when redeemer is {
  Cancel -> handle_cancel(datum, tx)
  Claim { signature } -> verify_signature(datum.owner, signature)
  Swap { amount_in, min_out } -> validate_swap(amount_in, min_out, tx)
}

COMMON PATTERNS:
- Signature check: list.has(tx.extra_signatories, datum.owner)
- Deadline check: tx.validity_range.lower_bound > datum.deadline
- Output finding: list.find(tx.outputs, fn(o) { o.address == own_address })
- Value check: value.lovelace_of(output.value) >= min_amount

IMPORTS (include if used):
use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use cardano/transaction.{Transaction, OutputReference}
</aiken_syntax_rules>

<uplc_to_aiken_translation>
When you see these UPLC patterns, translate to Aiken:
- equalsInteger(a, b) → a == b
- lessThanInteger(a, b) → a < b
- addInteger(a, b) → a + b
- multiplyInteger(a, b) → a * b
- divideInteger(a, b) → a / b
- ifThenElse(cond, t, f) → if cond { t } else { f }
- unConstrData + fstPair check → when redeemer is { ... }
- headList/tailList chains → pattern matching on constructor fields
- verifyEd25519Signature → crypto.verify_signature()
- sha2_256 → crypto.sha256()
- equalsByteString → ==
- appendByteString → bytearray.concat()
- trace("msg") → trace @"msg"
</uplc_to_aiken_translation>

<mermaid_rules>
- Use flowchart TD (top-down direction)
- Show validation paths for each redeemer variant
- Include decision nodes for checks (signatures, deadlines, amounts)
- Maximum 15 nodes for readability
- Escape special characters in labels
</mermaid_rules>

<important>
- The output MUST compile with the Aiken compiler
- Never output raw UPLC builtins like unConstrData, fstPair, equalsInteger
- Always use proper Aiken operators and syntax
- Include necessary imports at the top
- Use descriptive variable names inferred from usage context
- If logic is too complex, break into helper functions
</important>`;

const AIKEN_ONLY_PROMPT = `<role>Cardano/Aiken expert reverse-engineer</role>

<task>Convert UPLC bytecode to valid, compilable Aiken code</task>

<output_format>
JSON only: {"aiken": "// valid aiken code"}
</output_format>

<rules>
CRITICAL: Output MUST be valid Aiken syntax that compiles.

CORRECT syntax:
- Comparisons: == != < > <= >= (NOT equalsInteger, lessThanInteger)
- Arithmetic: + - * / % (NOT addInteger, multiplyInteger)
- Boolean: && || ! (NOT andBool, orBool)
- Pattern matching: when x is { Variant -> ... }
- Conditionals: if cond { ... } else { ... }

TRANSLATE UPLC builtins:
- equalsInteger(a,b) → a == b
- lessThanInteger(a,b) → a < b  
- addInteger(a,b) → a + b
- multiplyInteger(a,b) → a * b
- divideInteger(a,b) → a / b
- ifThenElse → if/else
- unConstrData pattern → when/is pattern matching

STRUCTURE:
validator name {
  spend(datum: Option<Datum>, redeemer: Redeemer, _ref: OutputReference, tx: Transaction) {
    expect Some(d) = datum
    when redeemer is {
      Variant1 -> ...
      Variant2 { field } -> ...
    }
  }
}

FORBIDDEN:
- Raw UPLC builtins (unConstrData, fstPair, headList, equalsInteger, etc.)
- "// Implementation omitted" comments
- Placeholder returns
</rules>`;

const MERMAID_TYPES_PROMPT = `<role>Smart contract analyzer</role>

<task>
From this Aiken contract code, produce:
1. Mermaid flowchart of validation logic
2. Inferred Datum and Redeemer type definitions
</task>

<output_format>
JSON only:
{
  "mermaid": "flowchart TD\\n  A[Start] --> B{Check}\\n  ...",
  "types": {
    "datum": "type Datum = { field: Type }",
    "redeemer": "type Redeemer = Variant1 | Variant2"
  }
}
</output_format>

<mermaid_rules>
- flowchart TD direction
- Show validation decision paths
- Max 15 nodes for readability
- Escape special chars in labels
</mermaid_rules>

<type_inference>
- Infer types from how fields are accessed and matched
- Use descriptive names based on context
- Identify enum variants from pattern matching
</type_inference>`;

// Standard call (for fallback/simpler tasks)
async function callAnthropic(
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  prefill: string = '{'
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
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userContent },
        { role: 'assistant', content: prefill }
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
  return prefill + data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// Extended thinking call (for complex UPLC analysis)
async function callAnthropicWithThinking(
  apiKey: string,
  systemPrompt: string,
  userContent: string,
  thinkingBudget: number = 10000
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
        { role: 'user', content: systemPrompt + '\n\n' + userContent }
      ],
    }),
  });

  if (!response.ok) {
    if (response.status === 429 || response.status === 529) {
      throw new Error('RATE_LIMIT');
    }
    const errText = await response.text();
    console.error('Anthropic thinking API error:', errText);
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text?: string; thinking?: string }> };
  // Extended thinking returns thinking blocks + text blocks - we only want the text
  return data.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

function parseJsonSafe<T>(text: string): T | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function compactUplc(uplc: string, maxLen: number = 80000): string {
  const compact = uplc
    .replace(/\n\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (compact.length <= maxLen) return compact;
  return compact.slice(0, maxLen) + ' [TRUNCATED]';
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { ANTHROPIC_API_KEY, UPLC_CACHE } = context.env;
  
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: 'API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': getCorsOrigin(context.request) },
    });
  }

  try {
    const { uplc, scriptHash } = await context.request.json() as { uplc: string; scriptHash?: string };
    
    if (!uplc || typeof uplc !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing UPLC code' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': getCorsOrigin(context.request) },
      });
    }

    // Check cache
    const cacheKey = scriptHash ? `analysis:${scriptHash}` : null;
    if (cacheKey && UPLC_CACHE) {
      const cached = await UPLC_CACHE.get(cacheKey);
      if (cached) {
        const parsed = parseJsonSafe<AnalysisResult>(cached);
        if (parsed && parsed.aiken && !parsed.aiken.includes('error')) {
          return new Response(JSON.stringify({ ...parsed, cached: true }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': getCorsOrigin(context.request) },
          });
        }
      }
    }

    const compactedUplc = compactUplc(uplc);
    let result: AnalysisResult;

    // Strategy 1: Try combined request with extended thinking for better analysis
    try {
      const rawResponse = await callAnthropicWithThinking(
        ANTHROPIC_API_KEY,
        COMBINED_PROMPT,
        `<uplc_bytecode>\n${compactedUplc}\n</uplc_bytecode>\n\nAnalyze this UPLC bytecode and respond with JSON only.`,
        10000  // 10k thinking tokens for complex analysis
      );
      
      // Extract JSON from response (may have text around it)
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? parseJsonSafe<{ aiken?: string; mermaid?: string; types?: { datum: string; redeemer: string } }>(jsonMatch[0]) : null;
      
      if (parsed?.aiken && parsed.aiken.length > 50) {
        result = {
          aiken: parsed.aiken,
          mermaid: parsed.mermaid,
          types: parsed.types,
        };
      } else {
        throw new Error('Combined request returned insufficient data');
      }
    } catch (combinedError) {
      // If rate limited, throw immediately
      if (combinedError instanceof Error && combinedError.message === 'RATE_LIMIT') {
        throw combinedError;
      }
      console.log('Combined request failed, trying split strategy:', combinedError);
      
      // Strategy 2: Split - Aiken first
      const aikenResponse = await callAnthropic(
        ANTHROPIC_API_KEY,
        AIKEN_ONLY_PROMPT,
        `Decompile this UPLC:\n\n${compactedUplc}`
      );
      
      const aikenParsed = parseJsonSafe<{ aiken?: string }>(aikenResponse);
      if (!aikenParsed?.aiken) {
        return new Response(JSON.stringify({ error: 'Failed to decompile UPLC' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': getCorsOrigin(context.request) },
        });
      }
      
      result = { aiken: aikenParsed.aiken };
      
      // Try to get mermaid + types (non-blocking, best effort)
      try {
        const mermaidResponse = await callAnthropic(
          ANTHROPIC_API_KEY,
          MERMAID_TYPES_PROMPT,
          `Analyze this Aiken contract:\n\n${aikenParsed.aiken.slice(0, 30000)}`
        );
        
        const mermaidParsed = parseJsonSafe<{ mermaid?: string; types?: { datum: string; redeemer: string } }>(mermaidResponse);
        if (mermaidParsed) {
          result.mermaid = mermaidParsed.mermaid;
          result.types = mermaidParsed.types;
        }
      } catch (mermaidError) {
        console.log('Mermaid/types generation failed:', mermaidError);
        // Continue without mermaid/types
      }
    }

    // Cache successful result
    if (cacheKey && UPLC_CACHE && result.aiken) {
      context.waitUntil(UPLC_CACHE.put(cacheKey, JSON.stringify(result)));
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': getCorsOrigin(context.request) },
    });
  } catch (err) {
    console.error('Analyze error:', err);
    const isRateLimit = err instanceof Error && err.message === 'RATE_LIMIT';
    return new Response(JSON.stringify({ 
      error: isRateLimit ? 'BUDGET_EXHAUSTED' : 'Analysis failed'
    }), {
      status: isRateLimit ? 429 : 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': getCorsOrigin(context.request) },
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
