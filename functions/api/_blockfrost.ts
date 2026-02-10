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
  if (env.UPLC_CACHE) {
    const cached = await env.UPLC_CACHE.get(`script:${scriptHash}`, 'json') as any;
    if (cached?.bytes) {
      return { type: cached.type, size: cached.size ?? 0, bytes: cached.bytes };
    }
  }

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

  if (env.UPLC_CACHE) {
    env.UPLC_CACHE.put(`script:${scriptHash}`, JSON.stringify({
      script_hash: scriptHash, ...result,
    })).catch(() => {});
  }

  return result;
}

// ── Epoch parameters (cost model + budgets) ──

const EPOCH_PARAMS_CACHE_KEY = 'epoch-params:v1';
const EPOCH_PARAMS_TTL = 5 * 24 * 3600; // 5 days (~1 epoch)

export interface EpochCostData {
  /** Per-builtin costs: { builtinName: { cpu: number, mem: number } } */
  builtinCosts: Record<string, { cpu: number; mem: number }>;
  /** CEK machine step costs: { stepType: { cpu: number, mem: number } } */
  machineCosts: {
    startup: { cpu: number; mem: number };
    var: { cpu: number; mem: number };
    const: { cpu: number; mem: number };
    lam: { cpu: number; mem: number };
    delay: { cpu: number; mem: number };
    force: { cpu: number; mem: number };
    apply: { cpu: number; mem: number };
    builtin: { cpu: number; mem: number };
    constr: { cpu: number; mem: number };
    case: { cpu: number; mem: number };
  };
  /** Transaction execution budget limits */
  txBudget: { cpu: number; mem: number };
  /** Epoch number this was fetched from */
  epoch: number;
}

/**
 * Fetch epoch cost parameters from Blockfrost.
 * Uses `cost_models.PlutusV3` (named format, not flat array).
 * Includes builtin costs, CEK machine costs, and tx budget.
 */
export async function fetchEpochCosts(env: BlockfrostEnv): Promise<EpochCostData | null> {
  try {
    // KV cache
    if (env.UPLC_CACHE) {
      const cached = await env.UPLC_CACHE.get(EPOCH_PARAMS_CACHE_KEY, 'json') as EpochCostData | null;
      if (cached) return cached;
    }

    const res = await blockfrostGet('/epochs/latest/parameters', env.BLOCKFROST_PROJECT_ID);
    if (!res.ok) return null;

    const params = await res.json() as any;
    const costModel = params.cost_models?.PlutusV3 as Record<string, number> | undefined;
    if (!costModel) return null;

    // Parse flat named keys into structured costs
    const builtinCosts: Record<string, { cpu: number; mem: number }> = {};
    const cekEntries: Record<string, number> = {};

    for (const [key, value] of Object.entries(costModel)) {
      if (key.startsWith('cek')) {
        cekEntries[key] = value;
        continue;
      }

      // Parse builtin cost entries:
      //   "headList-cpu-arguments" → constant cost
      //   "addInteger-cpu-arguments-intercept" → variable cost (intercept)
      //   "addInteger-cpu-arguments-slope" → variable cost (slope)
      const cpuMatch = key.match(/^(.+)-cpu-arguments(?:-(.+))?$/);
      const memMatch = key.match(/^(.+)-memory-arguments(?:-(.+))?$/);

      if (cpuMatch) {
        const [, name, param] = cpuMatch;
        if (!builtinCosts[name]) builtinCosts[name] = { cpu: 0, mem: 0 };
        if (!param) {
          // Constant cost
          builtinCosts[name].cpu = value;
        } else if (param === 'intercept') {
          builtinCosts[name].cpu = value; // Start with intercept, slope added below
        } else if (param === 'slope' && builtinCosts[name].cpu > 0) {
          // Add slope × typical_size to intercept
          builtinCosts[name].cpu += value * getTypicalSize(name);
        }
        // Skip slope1, slope2, constant, c0, c1, c2 etc. — intercept is sufficient approximation
      }

      if (memMatch) {
        const [, name, param] = memMatch;
        if (!builtinCosts[name]) builtinCosts[name] = { cpu: 0, mem: 0 };
        if (!param) {
          builtinCosts[name].mem = value;
        } else if (param === 'intercept') {
          builtinCosts[name].mem = value;
        } else if (param === 'slope' && builtinCosts[name].mem > 0) {
          builtinCosts[name].mem += value * getTypicalSize(name);
        }
      }
    }

    // Parse CEK machine costs
    const cek = (name: string) => ({
      cpu: cekEntries[`${name}-exBudgetCPU`] ?? 16000,
      mem: cekEntries[`${name}-exBudgetMemory`] ?? 100,
    });

    const result: EpochCostData = {
      builtinCosts,
      machineCosts: {
        startup: cek('cekStartupCost'),
        var: cek('cekVarCost'),
        const: cek('cekConstCost'),
        lam: cek('cekLamCost'),
        delay: cek('cekDelayCost'),
        force: cek('cekForceCost'),
        apply: cek('cekApplyCost'),
        builtin: cek('cekBuiltinCost'),
        constr: cek('cekConstrCost'),
        case: cek('cekCaseCost'),
      },
      txBudget: {
        cpu: parseInt(params.max_tx_ex_steps) || 10_000_000_000,
        mem: parseInt(params.max_tx_ex_mem) || 14_000_000,
      },
      epoch: params.epoch ?? 0,
    };

    // Cache for ~1 epoch
    if (env.UPLC_CACHE) {
      env.UPLC_CACHE.put(EPOCH_PARAMS_CACHE_KEY, JSON.stringify(result), {
        expirationTtl: EPOCH_PARAMS_TTL,
      }).catch(() => {});
    }

    return result;
  } catch {
    return null;
  }
}

// ── Script redeemers (actual execution costs) ──

const REDEEMERS_CACHE_TTL = 3600; // 1 hour

export interface ExecutionStats {
  sampleCount: number;
  cpu: { min: number; max: number; avg: number; median: number };
  memory: { min: number; max: number; avg: number; median: number };
  budgetPercent: {
    cpu: { avg: number; max: number };
    memory: { avg: number; max: number };
  };
  /** Most recent redeemer purposes seen */
  purposes: string[];
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Fetch recent redeemer executions for a script and compute statistics.
 * Returns null if the script has never been executed.
 */
export async function fetchExecutionStats(
  scriptHash: string,
  env: BlockfrostEnv,
): Promise<ExecutionStats | null> {
  const cacheKey = `redeemers:v1:${scriptHash}`;

  if (env.UPLC_CACHE) {
    const cached = await env.UPLC_CACHE.get(cacheKey, 'json') as ExecutionStats | null;
    if (cached) return cached;
  }

  try {
    // Fetch up to 100 most recent redeemers
    const res = await blockfrostGet(
      `/scripts/${scriptHash}/redeemers?count=100&order=desc`,
      env.BLOCKFROST_PROJECT_ID,
    );

    if (res.status === 404) return null;
    if (!res.ok) return null;

    const redeemers = await res.json() as Array<{
      tx_hash: string;
      tx_index: number;
      purpose: string;
      unit_mem: string;
      unit_steps: string;
    }>;

    if (!redeemers || redeemers.length === 0) return null;

    const cpuValues = redeemers.map(r => parseInt(r.unit_steps)).sort((a, b) => a - b);
    const memValues = redeemers.map(r => parseInt(r.unit_mem)).sort((a, b) => a - b);
    const purposes = [...new Set(redeemers.map(r => r.purpose))];

    const cpuAvg = Math.round(cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length);
    const memAvg = Math.round(memValues.reduce((a, b) => a + b, 0) / memValues.length);

    const txBudgetCpu = 10_000_000_000;
    const txBudgetMem = 14_000_000;

    const result: ExecutionStats = {
      sampleCount: redeemers.length,
      cpu: {
        min: cpuValues[0],
        max: cpuValues[cpuValues.length - 1],
        avg: cpuAvg,
        median: median(cpuValues),
      },
      memory: {
        min: memValues[0],
        max: memValues[memValues.length - 1],
        avg: memAvg,
        median: median(memValues),
      },
      budgetPercent: {
        cpu: {
          avg: Math.round(cpuAvg / txBudgetCpu * 10000) / 100,
          max: Math.round(cpuValues[cpuValues.length - 1] / txBudgetCpu * 10000) / 100,
        },
        memory: {
          avg: Math.round(memAvg / txBudgetMem * 10000) / 100,
          max: Math.round(memValues[memValues.length - 1] / txBudgetMem * 10000) / 100,
        },
      },
      purposes,
    };

    if (env.UPLC_CACHE) {
      env.UPLC_CACHE.put(cacheKey, JSON.stringify(result), {
        expirationTtl: REDEEMERS_CACHE_TTL,
      }).catch(() => {});
    }

    return result;
  } catch {
    return null;
  }
}

/** Typical argument sizes (words) for slope-based cost estimates */
function getTypicalSize(builtin: string): number {
  if (builtin.includes('Integer') || builtin === 'modInteger' || builtin === 'divideInteger' ||
      builtin === 'quotientInteger' || builtin === 'remainderInteger') return 1;
  if (builtin.includes('ByteString') || builtin.includes('Byte') || builtin.includes('Bit') ||
      builtin.includes('sha') || builtin.includes('blake') || builtin.includes('keccak') ||
      builtin.includes('ripemd') || builtin.includes('verify') || builtin.includes('bls12')) return 4;
  if (builtin.includes('String') || builtin === 'encodeUtf8' || builtin === 'decodeUtf8') return 2;
  if (builtin.includes('Data') || builtin.includes('Constr') || builtin === 'serialiseData') return 20;
  return 4;
}
