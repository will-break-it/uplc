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

const COMBINED_PROMPT = `You are a Cardano/Plutus reverse engineer. Analyze this UPLC bytecode to understand the contract's interface.

Your task:
1. Decompile to Aiken-style pseudocode
2. Create a Mermaid flowchart of validation logic
3. INFER the Datum and Redeemer types from how they're used in the code

RESPOND WITH JSON ONLY:
{
  "aiken": "// decompiled validator code",
  "mermaid": "flowchart TD\\n  A[Entry] --> B{Redeemer?}\\n  ...",
  "types": {
    "datum": "type Datum = { seller: Address, price: Int, token: AssetClass }",
    "redeemer": "type Redeemer = Buy | Sell | Cancel | UpdatePrice(Int)"
  }
}

DECOMPILATION:
- Show real logic, not descriptions
- Follow every lambda, application, builtin
- Trace data flow through datum/redeemer/ctx destructuring
- Identify validation conditions

MERMAID:
- flowchart TD (top-down)
- Show validation paths per redeemer variant
- Decision nodes for checks (signatures, deadlines, amounts)
- Max 15 nodes, readable labels
- Escape special chars

TYPE INFERENCE (most important):
- Datum: Look for unConstrData followed by field extraction (headList/tailList chains)
- Redeemer: Look for constructor checks (equalsInteger on fstPair of unConstrData)
- Name fields based on how they're used (e.g., compared with signature = "signer")
- Identify variants from pattern matching on constructor indices
- Common patterns:
  - unBData = ByteString field
  - unIData = Integer field  
  - Constr 0/1/2... = variant indices
  - verifyEd25519Signature usage = signature field

If UPLC is truncated, provide best-effort inference.
Output valid JSON only. No markdown.`;

const AIKEN_ONLY_PROMPT = `You are a Cardano/Plutus decompiler. Convert UPLC to Aiken-style pseudocode.

RESPOND WITH JSON ONLY:
{"aiken": "// decompiled code here"}

RULES:
- Actually decompile - show real logic
- Follow every lambda, application, builtin
- Use Aiken syntax: validator, let, if/else, when/is
- No placeholders or descriptions

Output valid JSON only.`;

const MERMAID_TYPES_PROMPT = `Analyze this Aiken smart contract code and provide:
1. A Mermaid flowchart of the logic
2. Type definitions for Datum and Redeemer

RESPOND WITH JSON ONLY:
{
  "mermaid": "flowchart TD\\n  A[Start] --> B{Check}\\n  ...",
  "types": {
    "datum": "type Datum = { field: Type }",
    "redeemer": "type Redeemer = Action1 | Action2"
  }
}

MERMAID RULES:
- flowchart TD (top-down)
- Show validation paths and decisions
- Max 15 nodes, keep readable
- Escape special chars

TYPE INFERENCE:
- Infer from how fields are accessed/matched
- Use descriptive names

Output valid JSON only.`;

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
