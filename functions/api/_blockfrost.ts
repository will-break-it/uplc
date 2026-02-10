/**
 * Blockfrost API helpers for on-chain data
 * 
 * Requires BLOCKFROST_PROJECT_ID env var.
 * Base URL: https://cardano-mainnet.blockfrost.io/api/v0
 */

const BLOCKFROST_BASE = 'https://cardano-mainnet.blockfrost.io/api/v0';

export interface BlockfrostEnv {
  BLOCKFROST_PROJECT_ID: string;
  UPLC_CACHE?: KVNamespace;
}

// ── CORS ───────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://uplc.wtf',
  'https://www.uplc.wtf',
  'https://uplc.pages.dev',
];

export function getCorsOrigin(request: Request): string {
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.includes(origin) || origin.startsWith('http://localhost:')) {
    return origin;
  }
  return 'https://uplc.wtf';
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export function optionsResponse(origin: string): Response {
  return new Response(null, { headers: corsHeaders(origin) });
}

export function jsonError(message: string, status: number, origin: string): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) } }
  );
}

export function jsonOk(data: unknown, origin: string, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin), ...extra },
  });
}

// ── Blockfrost fetch ───────────────────────

function blockfrostGet(path: string, projectId: string): Promise<Response> {
  return fetch(`${BLOCKFROST_BASE}${path}`, {
    headers: { 'project_id': projectId },
  });
}

// ── Script data ────────────────────────────

/**
 * Fetch script metadata + CBOR bytes.
 * KV cache → Blockfrost /scripts/{hash} + /scripts/{hash}/cbor
 */
export async function fetchScript(
  scriptHash: string,
  env: BlockfrostEnv,
): Promise<{ type: string; size: number; bytes: string } | { error: string; status: number }> {
  // KV cache (immutable on-chain data)
  if (env.UPLC_CACHE) {
    const cached = await env.UPLC_CACHE.get(`script:${scriptHash}`, 'json') as any;
    if (cached?.bytes) {
      return { type: cached.type, size: cached.size ?? 0, bytes: cached.bytes };
    }
  }

  // Blockfrost: script info + CBOR in parallel
  const [infoRes, cborRes] = await Promise.all([
    blockfrostGet(`/scripts/${scriptHash}`, env.BLOCKFROST_PROJECT_ID),
    blockfrostGet(`/scripts/${scriptHash}/cbor`, env.BLOCKFROST_PROJECT_ID),
  ]);

  if (infoRes.status === 404 || cborRes.status === 404) {
    return { error: 'Script not found on chain', status: 404 };
  }
  if (!infoRes.ok) return { error: `Blockfrost error: ${infoRes.status}`, status: 502 };
  if (!cborRes.ok) return { error: `Blockfrost CBOR error: ${cborRes.status}`, status: 502 };

  const info = await infoRes.json() as { type: string; serialised_size: number | null };
  const cbor = await cborRes.json() as { cbor: string };

  if (!cbor.cbor) {
    return { error: 'Script is a native script (no Plutus bytecode)', status: 400 };
  }

  const result = {
    type: info.type,
    size: info.serialised_size ?? cbor.cbor.length / 2,
    bytes: cbor.cbor,
  };

  // Cache forever (script data is immutable on-chain)
  if (env.UPLC_CACHE) {
    env.UPLC_CACHE.put(`script:${scriptHash}`, JSON.stringify({
      script_hash: scriptHash, ...result,
    })).catch(() => {});
  }

  return result;
}

// ── Cost model ─────────────────────────────

const COST_MODEL_CACHE_KEY = 'plutus-cost-model:v2';
const COST_MODEL_TTL = 5 * 24 * 3600; // 5 days (~1 epoch)

/** Machine cost entry from cost model */
export interface MachineCosts {
  cekStartupCost: { cpu: number; mem: number };
  cekVarCost: { cpu: number; mem: number };
  cekConstCost: { cpu: number; mem: number };
  cekLamCost: { cpu: number; mem: number };
  cekDelayCost: { cpu: number; mem: number };
  cekForceCost: { cpu: number; mem: number };
  cekApplyCost: { cpu: number; mem: number };
  cekBuiltinCost: { cpu: number; mem: number };
  cekConstrCost: { cpu: number; mem: number };
  cekCaseCost: { cpu: number; mem: number };
}

export interface CostModelResult {
  builtinModel: Record<string, any> | null;
  machineCosts: MachineCosts | null;
}

/**
 * Fetch Plutus V3 cost model (builtins + machine costs) from Blockfrost epoch params.
 * KV cache (5 days) → Blockfrost /epochs/latest/parameters
 */
export async function fetchCostModel(env: BlockfrostEnv): Promise<CostModelResult> {
  const empty: CostModelResult = { builtinModel: null, machineCosts: null };

  try {
    // KV cache
    if (env.UPLC_CACHE) {
      const cached = await env.UPLC_CACHE.get(COST_MODEL_CACHE_KEY, 'json') as CostModelResult | null;
      if (cached?.builtinModel) return cached;
    }

    // Blockfrost epoch params
    const res = await blockfrostGet('/epochs/latest/parameters', env.BLOCKFROST_PROJECT_ID);
    if (!res.ok) return empty;

    const params = await res.json() as any;
    const raw = params.cost_models_raw?.PlutusV3;

    let builtinModel: Record<string, any> | null = null;
    let machineCosts: MachineCosts | null = null;

    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      // Separate machine costs (cek*) from builtin costs
      const builtins: Record<string, any> = {};
      const machine: Record<string, any> = {};

      for (const [key, value] of Object.entries(raw)) {
        if (key.startsWith('cek')) {
          machine[key] = value;
        } else {
          builtins[key] = value;
        }
      }

      if (Object.keys(builtins).length > 0) builtinModel = builtins;

      // Parse machine costs if present
      if (machine.cekApplyCost) {
        const m = (entry: any) => ({
          cpu: entry?.exBudgetCPU ?? entry?.cpu ?? 23000,
          mem: entry?.exBudgetMemory ?? entry?.memory ?? 100,
        });
        machineCosts = {
          cekStartupCost: m(machine.cekStartupCost),
          cekVarCost: m(machine.cekVarCost),
          cekConstCost: m(machine.cekConstCost),
          cekLamCost: m(machine.cekLamCost),
          cekDelayCost: m(machine.cekDelayCost),
          cekForceCost: m(machine.cekForceCost),
          cekApplyCost: m(machine.cekApplyCost),
          cekBuiltinCost: m(machine.cekBuiltinCost),
          cekConstrCost: m(machine.cekConstrCost),
          cekCaseCost: m(machine.cekCaseCost),
        };
      }
    }

    const result: CostModelResult = { builtinModel, machineCosts };

    // Cache
    if (env.UPLC_CACHE) {
      env.UPLC_CACHE.put(COST_MODEL_CACHE_KEY, JSON.stringify(result), {
        expirationTtl: COST_MODEL_TTL,
      }).catch(() => {});
    }

    return result;
  } catch {
    return empty;
  }
}
