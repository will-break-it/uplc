/**
 * Cloudflare Function - GitHub Issue Auto-Filing
 * 
 * Files GitHub issues when decompilation confidence is not 'high'.
 * Rate-limited by checking for existing issues with same hash prefix.
 */

export interface Env {
  GITHUB_TOKEN: string;
}

interface VerificationData {
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
}

interface ReportRequest {
  scriptHash: string;
  stage: 'static' | 'ai';
  verification: VerificationData;
  staticVerification?: VerificationData;
}

const ALLOWED_ORIGINS = [
  'https://uplc.wtf',
  'https://www.uplc.wtf',
  'https://uplc.pages.dev',
  'http://localhost:4321'
];

const REPO_OWNER = 'will-break-it';
const REPO_NAME = 'uplc';

function getCorsOrigin(request: Request): string {
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    return origin;
  }
  return 'https://uplc.wtf';
}

/**
 * Try to decode hex to ASCII for display
 */
function hexToAscii(hex: string): string | null {
  if (hex.length % 2 !== 0) return null;
  let result = '';
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substring(i, i + 2), 16);
    if (byte < 32 || byte > 126) return null;
    result += String.fromCharCode(byte);
  }
  return result.length >= 2 ? result : null;
}

/**
 * Check if an issue already exists for this script hash
 * Returns the existing issue URL if found, null otherwise
 */
async function findExistingIssue(
  scriptHash: string,
  stage: 'static' | 'ai',
  token: string
): Promise<{ exists: boolean; url?: string; number?: number }> {
  const label = stage === 'static' ? 'decompile-bug' : 'enhance-bug';
  const hashPrefix = scriptHash.slice(0, 12);
  
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues?state=open&labels=${label}&per_page=100`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'uplc-wtf-bot',
        },
      }
    );

    if (!response.ok) {
      console.error('Failed to fetch issues:', response.status);
      return { exists: false };
    }

    const issues = await response.json() as Array<{ title: string; html_url: string; number: number }>;
    
    // Check if any existing issue contains our hash prefix
    const existing = issues.find(issue => issue.title.includes(hashPrefix));
    if (existing) {
      return { exists: true, url: existing.html_url, number: existing.number };
    }
    return { exists: false };
  } catch (error) {
    console.error('Error checking existing issues:', error);
    return { exists: false };
  }
}

/**
 * Create a GitHub issue
 */
async function createIssue(
  title: string,
  body: string,
  labels: string[],
  token: string
): Promise<{ success: boolean; issueUrl?: string; issueNumber?: number; error?: string }> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/issues`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'uplc-wtf-bot',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title, body, labels }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      return { success: false, error: `GitHub API error: ${response.status} - ${errorBody}` };
    }

    const issue = await response.json() as { html_url: string; number: number };
    return { success: true, issueUrl: issue.html_url, issueNumber: issue.number };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Build issue body for static decompilation bugs
 */
function buildStaticIssueBody(scriptHash: string, verification: VerificationData): string {
  const lines = [
    `## Static Decompilation Issue`,
    ``,
    `The deterministic UPLC → Aiken decompiler produced output with verification gaps.`,
    `This is a bug in the parser, codegen, or pattern detection — not an AI issue.`,
    ``,
    `**Script:** [\`${scriptHash}\`](https://uplc.wtf/script/${scriptHash})`,
    `**Confidence:** ${verification.confidence}`,
    ``,
  ];

  // Constants: show exact counts and every missing one
  const { foundConstants, totalConstants, missingConstants } = verification;
  lines.push(`### Constants (${foundConstants}/${totalConstants} found in decompiled code)`);
  lines.push(``);
  if (missingConstants.length === 0) {
    lines.push(`All constants preserved. ✅`);
  } else {
    lines.push(`**${missingConstants.length} constant(s) from UPLC bytecode not found in Aiken output:**`);
    lines.push(``);
    for (const c of missingConstants) {
      if (/^[a-f0-9]+$/i.test(c) && c.length >= 8) {
        const ascii = hexToAscii(c);
        lines.push(ascii
          ? `- \`#"${c}"\` → \`"${ascii}"\` (${c.length / 2} bytes)`
          : `- \`#"${c}"\` (${c.length / 2} bytes)`);
      } else {
        lines.push(`- \`${c}\``);
      }
    }
  }
  lines.push(``);

  // Undefined functions: show all
  if (verification.undefinedFunctions.length > 0) {
    lines.push(`### Undefined Functions (${verification.undefinedFunctions.length} referenced but never defined)`);
    lines.push(``);
    for (const fn of verification.undefinedFunctions) {
      lines.push(`- \`${fn}()\``);
    }
    lines.push(``);
  }

  // Placeholders: show all
  if (verification.placeholders.length > 0) {
    lines.push(`### Placeholders (${verification.placeholders.length} found)`);
    lines.push(``);
    for (const p of verification.placeholders) {
      lines.push(`- \`${p}\``);
    }
    lines.push(``);
  }

  // Scores summary
  lines.push(`### Scores`);
  lines.push(``);
  lines.push(`- **Constants:** ${(verification.constantScore * 100).toFixed(1)}% — ${foundConstants} of ${totalConstants} bytecode constants found in output`);
  lines.push(`- **References:** ${(verification.referenceScore * 100).toFixed(1)}% — ratio of defined to referenced functions`);
  lines.push(`- **Placeholders:** ${(verification.placeholderScore * 100).toFixed(1)}% — \`???\`, \`TODO\`, stub patterns`);
  lines.push(`- **Abstraction:** ${(verification.abstractionScore * 100).toFixed(1)}% — inverse of raw \`builtin.*\` density`);
  lines.push(``);

  lines.push(`---`);
  lines.push(`*Auto-filed by [UPLC.WTF](https://uplc.wtf) verification system*`);

  return lines.join('\n');
}

/**
 * Build issue body for AI enhancement bugs
 */
function buildAIIssueBody(
  scriptHash: string,
  verification: VerificationData,
  staticVerification?: VerificationData
): string {
  const lines = [
    `## AI Enhancement Issue`,
    ``,
    `The AI rewrite (Claude) produced output with quality issues.`,
    `This may be a prompt problem, missing context, or model hallucination.`,
    ``,
    `**Script:** [\`${scriptHash}\`](https://uplc.wtf/script/${scriptHash})`,
    `**Retry:** [Force re-enhancement](https://uplc.wtf/script/${scriptHash}?retry=enhance)`,
    `**Confidence:** ${verification.confidence}`,
    ``,
  ];

  // Constants comparison: AI vs static
  const { foundConstants, totalConstants, missingConstants } = verification;
  const staticFound = staticVerification?.foundConstants ?? '?';
  const staticTotal = staticVerification?.totalConstants ?? '?';
  lines.push(`### Constants`);
  lines.push(``);
  lines.push(`- **AI output:** ${foundConstants}/${totalConstants} found`);
  lines.push(`- **Static output:** ${staticFound}/${staticTotal} found`);
  lines.push(``);
  if (missingConstants.length > 0) {
    lines.push(`**${missingConstants.length} constant(s) the AI dropped or failed to include:**`);
    lines.push(``);
    for (const c of missingConstants) {
      if (/^[a-f0-9]+$/i.test(c) && c.length >= 8) {
        const ascii = hexToAscii(c);
        lines.push(ascii
          ? `- \`#"${c}"\` → \`"${ascii}"\` (${c.length / 2} bytes)`
          : `- \`#"${c}"\` (${c.length / 2} bytes)`);
      } else {
        lines.push(`- \`${c}\``);
      }
    }
    lines.push(``);
  }

  // Undefined functions (hallucinated): show all
  if (verification.undefinedFunctions.length > 0) {
    lines.push(`### Undefined Functions (${verification.undefinedFunctions.length} — AI referenced but never defined)`);
    lines.push(``);
    for (const fn of verification.undefinedFunctions) {
      lines.push(`- \`${fn}()\``);
    }
    lines.push(``);
  }

  // Placeholders: show all
  if (verification.placeholders.length > 0) {
    lines.push(`### Placeholders (${verification.placeholders.length} found)`);
    lines.push(``);
    for (const p of verification.placeholders) {
      lines.push(`- \`${p}\``);
    }
    lines.push(``);
  }

  // Scores: AI vs static side by side
  lines.push(`### Scores (AI → Static)`);
  lines.push(``);
  const s = staticVerification;
  lines.push(`- **Constants:** ${(verification.constantScore * 100).toFixed(1)}%${s ? ` → ${(s.constantScore * 100).toFixed(1)}%` : ''}`);
  lines.push(`- **References:** ${(verification.referenceScore * 100).toFixed(1)}%${s ? ` → ${(s.referenceScore * 100).toFixed(1)}%` : ''}`);
  lines.push(`- **Placeholders:** ${(verification.placeholderScore * 100).toFixed(1)}%${s ? ` → ${(s.placeholderScore * 100).toFixed(1)}%` : ''}`);
  lines.push(`- **Abstraction:** ${(verification.abstractionScore * 100).toFixed(1)}%${s ? ` → ${(s.abstractionScore * 100).toFixed(1)}%` : ''}`);
  lines.push(``);

  lines.push(`---`);
  lines.push(`*Auto-filed by [UPLC.WTF](https://uplc.wtf) verification system*`);

  return lines.join('\n');
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const corsOrigin = getCorsOrigin(context.request);

  // CORS preflight
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

  // Check for GitHub token
  if (!context.env.GITHUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'GitHub integration not configured' }), {
      status: 503,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': corsOrigin,
      },
    });
  }

  try {
    const body = await context.request.json() as ReportRequest;

    if (!body.scriptHash || !body.stage || !body.verification) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': corsOrigin,
        },
      });
    }

    // Don't report high-confidence results
    if (body.verification.confidence === 'high') {
      return new Response(JSON.stringify({ reported: false, reason: 'High confidence - no issues to report' }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': corsOrigin,
        },
      });
    }

    // Check for existing issue (rate limiting)
    const existingIssue = await findExistingIssue(body.scriptHash, body.stage, context.env.GITHUB_TOKEN);
    if (existingIssue.exists) {
      return new Response(JSON.stringify({ 
        reported: false, 
        alreadyExists: true,
        existingUrl: existingIssue.url,
        issueNumber: existingIssue.number,
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': corsOrigin,
        },
      });
    }

    // Build issue content
    const hashPrefix = body.scriptHash.slice(0, 12);
    let title: string;
    let issueBody: string;
    let labels: string[];

    if (body.stage === 'static') {
      title = `[decompile-bug] Missing constants in ${hashPrefix}...`;
      issueBody = buildStaticIssueBody(body.scriptHash, body.verification);
      labels = ['decompile-bug', 'auto-reported'];
    } else {
      title = `[enhance-bug] AI quality issues in ${hashPrefix}...`;
      issueBody = buildAIIssueBody(body.scriptHash, body.verification, body.staticVerification);
      labels = ['enhance-bug', 'auto-reported'];
    }

    // Create the issue
    const result = await createIssue(title, issueBody, labels, context.env.GITHUB_TOKEN);

    if (result.success) {
      return new Response(JSON.stringify({ 
        reported: true, 
        issueUrl: result.issueUrl,
        issueNumber: result.issueNumber,
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': corsOrigin,
        },
      });
    } else {
      return new Response(JSON.stringify({ reported: false, error: result.error }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': corsOrigin,
        },
      });
    }
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
