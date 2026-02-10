/**
 * Script info proxy — /api/koios (legacy path, uses Blockfrost)
 * 
 * Used by the frontend's fetchScriptInfo() for quick existence checks.
 */

import {
  type BlockfrostEnv,
  getCorsOrigin, optionsResponse, corsHeaders, jsonError,
  fetchScript,
} from './_blockfrost';

type Env = BlockfrostEnv;

export const onRequest: PagesFunction<Env> = async (context) => {
  const corsOrigin = getCorsOrigin(context.request);

  if (context.request.method === 'OPTIONS') {
    return optionsResponse(corsOrigin);
  }

  try {
    let scriptHashes: string[] = [];

    if (context.request.method === 'GET') {
      const url = new URL(context.request.url);
      const hash = url.searchParams.get('_script_hashes');
      if (hash) scriptHashes = [hash];
    } else if (context.request.method === 'POST') {
      const body = await context.request.json() as { _script_hashes?: string[] };
      scriptHashes = body._script_hashes || [];
    }

    if (scriptHashes.length === 0) {
      return jsonError('Missing _script_hashes parameter', 400, corsOrigin);
    }

    const results: any[] = [];
    for (const hash of scriptHashes) {
      const result = await fetchScript(hash, context.env);
      if ('error' in result) continue;
      results.push({
        script_hash: hash,
        type: result.type,
        size: result.size,
        bytes: result.bytes,
      });
    }

    if (results.length === 0) {
      return jsonError('Script not found on chain', 404, corsOrigin);
    }

    return new Response(JSON.stringify(results), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=31536000, immutable',
        ...corsHeaders(corsOrigin),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return jsonError(message, 500, corsOrigin);
  }
};
