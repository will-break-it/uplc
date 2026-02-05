// Cloudflare Pages Function for combined AI analysis with retry fallback
// Strategy: Try combined (aiken+mermaid+types) first, on failure split into separate calls

interface Env {
  ANTHROPIC_API_KEY: string;
  UPLC_CACHE: KVNamespace;
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

const COMBINED_PROMPT = `<role>You are an expert Cardano/Plutus reverse engineer specializing in UPLC bytecode analysis.</role>

<task>
Analyze the provided UPLC bytecode to:
1. Decompile to Aiken-style pseudocode
2. Create a Mermaid flowchart showing validation logic
3. Infer Datum and Redeemer type definitions from code patterns
</task>

<output_format>
Respond with valid JSON only (no markdown, no code fences):
{
  "aiken": "// decompiled validator code here",
  "mermaid": "flowchart TD\\n  A[Entry] --> B{Redeemer}\\n  ...",
  "types": {
    "datum": "type Datum = { field1: Type, field2: Type }",
    "redeemer": "type Redeemer = Variant1 | Variant2 | Variant3(args)"
  }
}
</output_format>

<decompilation_rules>
- Show actual logic, not descriptions or summaries
- Follow every lambda, application, and builtin call
- Trace data flow through datum/redeemer/ctx destructuring
- Preserve validation conditions and their relationships
- Use Aiken syntax: validator, let, if/else, when/is
</decompilation_rules>

<mermaid_rules>
- Use flowchart TD (top-down direction)
- Show validation paths for each redeemer variant
- Include decision nodes for checks (signatures, deadlines, amounts)
- Maximum 15 nodes for readability
- Escape special characters in labels
</mermaid_rules>

<type_inference_patterns>
Datum fields - look for:
- unConstrData followed by headList/tailList chains (field extraction)
- unBData = ByteString field
- unIData = Integer field
- Name fields by usage context (e.g., verifySignature param = "signer")

Redeemer variants - look for:
- equalsInteger on fstPair of unConstrData (constructor matching)
- Constr 0, 1, 2... indices = variant cases
- Pattern: ifThenElse with constructor checks = when/is branches
</type_inference_patterns>

<important>
- If UPLC is truncated, provide best-effort analysis
- Focus on type inference - this is the primary value
- Types should have descriptive field/variant names based on usage
</important>`;

const AIKEN_ONLY_PROMPT = `<role>Cardano/Plutus decompiler</role>

<task>Convert UPLC bytecode to Aiken-style pseudocode</task>

<output_format>
JSON only: {"aiken": "// decompiled code"}
</output_format>

<rules>
- Decompile actual logic, not descriptions
- Follow every lambda, application, builtin
- Use Aiken syntax: validator, let, if/else, when/is
- No placeholders like "validation logic here"
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
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json() as { content: Array<{ type: string; text?: string }> };
  return prefill + data.content.filter(b => b.type === 'text').map(b => b.text).join('');
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

    // Check cache
    const cacheKey = scriptHash ? `analysis:${scriptHash}` : null;
    if (cacheKey && UPLC_CACHE) {
      const cached = await UPLC_CACHE.get(cacheKey);
      if (cached) {
        const parsed = parseJsonSafe<AnalysisResult>(cached);
        if (parsed && parsed.aiken && !parsed.aiken.includes('error')) {
          return new Response(JSON.stringify({ ...parsed, cached: true }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          });
        }
      }
    }

    const compactedUplc = compactUplc(uplc);
    let result: AnalysisResult;

    // Strategy 1: Try combined request
    try {
      const rawResponse = await callAnthropic(
        ANTHROPIC_API_KEY,
        COMBINED_PROMPT,
        `Analyze this UPLC:\n\n${compactedUplc}`
      );
      
      const parsed = parseJsonSafe<{ aiken?: string; mermaid?: string; types?: { datum: string; redeemer: string } }>(rawResponse);
      
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
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    console.error('Analyze error:', err);
    return new Response(JSON.stringify({ error: 'Analysis failed' }), {
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
