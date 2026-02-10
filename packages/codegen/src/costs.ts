/**
 * Plutus Cost Model
 * 
 * Estimates execution costs from:
 *   1. Builtin invocations (variable-cost builtins use typical argument sizes)
 *   2. CEK machine step costs (lambda, apply, force, delay, var, const, etc.)
 * 
 * Uses actual Plutus V3 mainnet cost model parameters.
 * For variable-cost builtins: intercept + slope × typical_size.
 * 
 * Typical argument sizes:
 *   Integer: 1 word | ByteString: 4 words (32 bytes)
 *   Data: 20 words  | String: 2 words
 */

/** AST node counts for CEK machine cost estimation */
export interface AstStats {
  lambdaCount: number;
  applicationCount: number;
  forceCount: number;
  delayCount: number;
  variableCount: number;
  constantCount: number;
  constrCount: number;
  caseCount: number;
}

export interface CostEstimate {
  cpu: bigint;
  memory: bigint;
  total: bigint;
  breakdown: {
    category: string;
    cpu: bigint;
    memory: bigint;
    count: number;
    builtins: string[];
  }[];
  budgetPercent: {
    cpu: number;
    memory: number;
  };
}

// Typical argument sizes (in words) for slope-based estimates
const TYPICAL_INT_SIZE = 1;
const TYPICAL_BS_SIZE = 4;   // 32 bytes
const TYPICAL_DATA_SIZE = 20;
const TYPICAL_STRING_SIZE = 2;

/**
 * CPU costs per builtin — from Plutus V3 mainnet cost model.
 * Variable-cost builtins use: intercept + slope × typical_size
 */
export const BUILTIN_CPU_COSTS: Record<string, bigint> = {
  // Integer arithmetic (max_size model: intercept + slope × max(size_a, size_b))
  addInteger: BigInt(205665 + 812 * TYPICAL_INT_SIZE),
  subtractInteger: BigInt(205665 + 812 * TYPICAL_INT_SIZE),
  multiplyInteger: BigInt(69522 + 11687 * (TYPICAL_INT_SIZE * 2)),
  // Division uses const_above_diagonal — use the constant for typical case
  divideInteger: 196500n,
  quotientInteger: 196500n,
  remainderInteger: 196500n,
  modInteger: 196500n,
  // Comparison (min_size model: intercept + slope × min(size_a, size_b))
  equalsInteger: BigInt(208512 + 421 * TYPICAL_INT_SIZE),
  lessThanInteger: BigInt(208896 + 511 * TYPICAL_INT_SIZE),
  lessThanEqualsInteger: BigInt(204924 + 473 * TYPICAL_INT_SIZE),

  // ByteString operations
  appendByteString: BigInt(1000 + 571 * (TYPICAL_BS_SIZE * 2)),
  consByteString: BigInt(221973 + 511 * TYPICAL_BS_SIZE),
  sliceByteString: 265318n,
  lengthOfByteString: 1000n,
  indexByteString: 57667n,
  equalsByteString: BigInt(216773 + 62 * TYPICAL_BS_SIZE),
  lessThanByteString: BigInt(197145 + 156 * TYPICAL_BS_SIZE),
  lessThanEqualsByteString: BigInt(197145 + 156 * TYPICAL_BS_SIZE),

  // Crypto (linear_in_x: intercept + slope × input_size)
  sha2_256: BigInt(806990 + 30482 * TYPICAL_BS_SIZE),
  sha3_256: BigInt(1927926 + 82523 * TYPICAL_BS_SIZE),
  blake2b_256: BigInt(117366 + 10475 * TYPICAL_BS_SIZE),
  blake2b_224: BigInt(207616 + 8310 * TYPICAL_BS_SIZE),
  keccak_256: BigInt(2261318 + 64571 * TYPICAL_BS_SIZE),
  ripemd_160: BigInt(1964219 + 24520 * TYPICAL_BS_SIZE),
  verifyEd25519Signature: BigInt(57996947 + 18975 * TYPICAL_BS_SIZE),
  verifyEcdsaSecp256k1Signature: 35190005n,
  verifySchnorrSecp256k1Signature: BigInt(39121781 + 32260 * TYPICAL_BS_SIZE),

  // String operations
  appendString: BigInt(1000 + 24177 * (TYPICAL_STRING_SIZE * 2)),
  equalsString: BigInt(1000 + 52998 * TYPICAL_STRING_SIZE),
  encodeUtf8: BigInt(1000 + 28662 * TYPICAL_STRING_SIZE),
  decodeUtf8: BigInt(497525 + 14068 * TYPICAL_STRING_SIZE),

  // Control flow (constant cost)
  ifThenElse: 80556n,
  chooseUnit: 46417n,
  chooseList: 175354n,
  chooseData: 19537n,
  trace: 212342n,

  // Pair operations (constant cost)
  fstPair: 80436n,
  sndPair: 85931n,
  mkPairData: 76511n,

  // List operations (constant cost)
  mkCons: 65493n,
  headList: 43249n,
  tailList: 41182n,
  nullList: 60091n,

  // Data operations (constant cost unless noted)
  constrData: 89141n,
  mapData: 64832n,
  listData: 52467n,
  iData: 1000n,
  bData: 1000n,
  unConstrData: 32696n,
  unMapData: 38314n,
  unListData: 32247n,
  unIData: 43357n,
  unBData: 31220n,
  equalsData: BigInt(1060367 + 12586 * TYPICAL_DATA_SIZE),
  mkNilData: 22558n,
  mkNilPairData: 16563n,
  serialiseData: BigInt(1159724 + 392670 * TYPICAL_DATA_SIZE),

  // BLS12-381
  bls12_381_G1_add: 962335n,
  bls12_381_G1_neg: 267929n,
  bls12_381_G1_scalarMul: BigInt(76433006 + 8868 * 32),
  bls12_381_G1_equal: 442008n,
  bls12_381_G1_hashToGroup: BigInt(52538055 + 3756 * TYPICAL_BS_SIZE),
  bls12_381_G1_compress: 2780678n,
  bls12_381_G1_uncompress: 52948122n,
  bls12_381_G2_add: 1995836n,
  bls12_381_G2_neg: 284546n,
  bls12_381_G2_scalarMul: BigInt(158221314 + 26549 * 32),
  bls12_381_G2_equal: 901022n,
  bls12_381_G2_hashToGroup: BigInt(166917843 + 4307 * TYPICAL_BS_SIZE),
  bls12_381_G2_compress: 3227919n,
  bls12_381_G2_uncompress: 74698472n,
  bls12_381_millerLoop: 254006273n,
  bls12_381_mulMlResult: 2174038n,
  bls12_381_finalVerify: 333849714n,

  // Bitwise (Plutus V3)
  integerToByteString: BigInt(1293828 + 28716 * TYPICAL_INT_SIZE),
  byteStringToInteger: BigInt(1006041 + 43623 * TYPICAL_BS_SIZE),
  andByteString: BigInt(100181 + 726 * TYPICAL_BS_SIZE + 719 * TYPICAL_BS_SIZE),
  orByteString: BigInt(100181 + 726 * TYPICAL_BS_SIZE + 719 * TYPICAL_BS_SIZE),
  xorByteString: BigInt(100181 + 726 * TYPICAL_BS_SIZE + 719 * TYPICAL_BS_SIZE),
  complementByteString: BigInt(107878 + 680 * TYPICAL_BS_SIZE),
  readBit: 95336n,
  writeBits: BigInt(281145 + 18848 * 1),
  replicateByte: BigInt(180194 + 159 * TYPICAL_BS_SIZE),
  shiftByteString: BigInt(158519 + 8942 * TYPICAL_BS_SIZE),
  rotateByteString: BigInt(159378 + 8813 * TYPICAL_BS_SIZE),
  countSetBits: BigInt(107490 + 3298 * TYPICAL_BS_SIZE),
  findFirstSetBit: BigInt(106057 + 655 * TYPICAL_BS_SIZE),
};

/**
 * Memory costs per builtin — from Plutus V3 mainnet cost model.
 * Most are constant_cost; variable ones use typical sizes.
 */
export const BUILTIN_MEMORY_COSTS: Record<string, bigint> = {
  // Integer (max_size / added_sizes / subtracted_sizes)
  addInteger: BigInt(1 + 1 * TYPICAL_INT_SIZE),
  subtractInteger: BigInt(1 + 1 * TYPICAL_INT_SIZE),
  multiplyInteger: BigInt(0 + 1 * (TYPICAL_INT_SIZE * 2)),
  divideInteger: 1n,
  quotientInteger: 1n,
  remainderInteger: 1n,
  modInteger: 1n,
  equalsInteger: 1n,
  lessThanInteger: 1n,
  lessThanEqualsInteger: 1n,

  // ByteString
  appendByteString: BigInt(0 + 1 * (TYPICAL_BS_SIZE * 2)),
  consByteString: BigInt(0 + 1 * (TYPICAL_BS_SIZE + 1)),
  sliceByteString: 4n,
  lengthOfByteString: 10n,
  indexByteString: 4n,
  equalsByteString: 1n,
  lessThanByteString: 1n,
  lessThanEqualsByteString: 1n,

  // Crypto (constant memory — output hash size)
  sha2_256: 4n,
  sha3_256: 4n,
  blake2b_256: 4n,
  blake2b_224: 4n,
  keccak_256: 4n,
  ripemd_160: 3n,
  verifyEd25519Signature: 10n,
  verifyEcdsaSecp256k1Signature: 10n,
  verifySchnorrSecp256k1Signature: 10n,

  // String
  appendString: BigInt(4 + 1 * (TYPICAL_STRING_SIZE * 2)),
  equalsString: 1n,
  encodeUtf8: BigInt(4 + 2 * TYPICAL_STRING_SIZE),
  decodeUtf8: BigInt(4 + 2 * TYPICAL_STRING_SIZE),

  // Control (constant)
  ifThenElse: 1n,
  chooseUnit: 4n,
  chooseList: 32n,
  chooseData: 32n,
  trace: 32n,

  // Pair (constant = 32)
  fstPair: 32n,
  sndPair: 32n,
  mkPairData: 32n,

  // List (constant = 32)
  mkCons: 32n,
  headList: 32n,
  tailList: 32n,
  nullList: 32n,

  // Data (constant = 32)
  constrData: 32n,
  mapData: 32n,
  listData: 32n,
  iData: 32n,
  bData: 32n,
  unConstrData: 32n,
  unMapData: 32n,
  unListData: 32n,
  unIData: 32n,
  unBData: 32n,
  equalsData: 1n,
  mkNilData: 32n,
  mkNilPairData: 32n,
  serialiseData: BigInt(0 + 2 * TYPICAL_DATA_SIZE),

  // BLS12-381
  bls12_381_G1_add: 18n,
  bls12_381_G1_neg: 18n,
  bls12_381_G1_scalarMul: 18n,
  bls12_381_G1_equal: 1n,
  bls12_381_G1_hashToGroup: 18n,
  bls12_381_G1_compress: 6n,
  bls12_381_G1_uncompress: 18n,
  bls12_381_G2_add: 36n,
  bls12_381_G2_neg: 36n,
  bls12_381_G2_scalarMul: 36n,
  bls12_381_G2_equal: 1n,
  bls12_381_G2_hashToGroup: 36n,
  bls12_381_G2_compress: 12n,
  bls12_381_G2_uncompress: 36n,
  bls12_381_millerLoop: 72n,
  bls12_381_mulMlResult: 72n,
  bls12_381_finalVerify: 1n,

  // Bitwise
  integerToByteString: BigInt(0 + 1 * TYPICAL_INT_SIZE),
  byteStringToInteger: BigInt(0 + 1 * TYPICAL_BS_SIZE),
  andByteString: BigInt(0 + 1 * TYPICAL_BS_SIZE),
  orByteString: BigInt(0 + 1 * TYPICAL_BS_SIZE),
  xorByteString: BigInt(0 + 1 * TYPICAL_BS_SIZE),
  complementByteString: BigInt(0 + 1 * TYPICAL_BS_SIZE),
  readBit: 1n,
  writeBits: BigInt(0 + 1 * TYPICAL_BS_SIZE),
  replicateByte: BigInt(1 + 1 * TYPICAL_BS_SIZE),
  shiftByteString: BigInt(0 + 1 * TYPICAL_BS_SIZE),
  rotateByteString: BigInt(0 + 1 * TYPICAL_BS_SIZE),
  countSetBits: 1n,
  findFirstSetBit: 1n,
};

/**
 * Mainnet per-transaction execution budget (Conway era)
 */
export const TX_BUDGET = {
  cpu: 10_000_000_000n,
  memory: 14_000_000n,
};

/**
 * CEK machine step costs.
 * Defaults from cekMachineCostsA.json (Plutus repo).
 * These are protocol parameters — can change per epoch via governance.
 */
export interface MachineCostParams {
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
}

const DEFAULT_MACHINE_COSTS: MachineCostParams = {
  startup: { cpu: 100, mem: 100 },
  var:     { cpu: 23000, mem: 100 },
  const:   { cpu: 23000, mem: 100 },
  lam:     { cpu: 23000, mem: 100 },
  delay:   { cpu: 23000, mem: 100 },
  force:   { cpu: 23000, mem: 100 },
  apply:   { cpu: 23000, mem: 100 },
  builtin: { cpu: 23000, mem: 100 },
  constr:  { cpu: 23000, mem: 100 },
  case:    { cpu: 23000, mem: 100 },
};

/**
 * Estimate CEK machine overhead from AST statistics.
 * Uses per-node-type costs from protocol parameters.
 */
function estimateMachineCost(
  stats: AstStats,
  mc: MachineCostParams,
): { cpu: bigint; memory: bigint; steps: number } {
  let cpu = BigInt(mc.startup.cpu);
  let memory = BigInt(mc.startup.mem);

  const pairs: [number, { cpu: number; mem: number }][] = [
    [stats.lambdaCount, mc.lam],
    [stats.applicationCount, mc.apply],
    [stats.forceCount, mc.force],
    [stats.delayCount, mc.delay],
    [stats.variableCount, mc.var],
    [stats.constantCount, mc.const],
    [stats.constrCount, mc.constr],
    [stats.caseCount, mc.case],
  ];

  let steps = 0;
  for (const [count, cost] of pairs) {
    steps += count;
    cpu += BigInt(cost.cpu) * BigInt(count);
    memory += BigInt(cost.mem) * BigInt(count);
  }

  return { cpu, memory, steps };
}

/**
 * Estimate execution cost from builtin counts + AST stats.
 * Includes both builtin costs and CEK machine overhead.
 */
export function estimateCost(
  builtinCounts: Record<string, number>,
  dynamicCpuCosts?: Record<string, bigint>,
  dynamicMemCosts?: Record<string, bigint>,
  astStats?: AstStats,
  machineCosts?: MachineCostParams,
): CostEstimate {
  const cpuMap = dynamicCpuCosts ?? BUILTIN_CPU_COSTS;
  const memMap = dynamicMemCosts ?? BUILTIN_MEMORY_COSTS;

  let totalCpu = 0n;
  let totalMemory = 0n;

  const categories: Record<string, { builtins: string[]; cpu: bigint; memory: bigint; count: number }> = {
    Integer: { builtins: [], cpu: 0n, memory: 0n, count: 0 },
    ByteString: { builtins: [], cpu: 0n, memory: 0n, count: 0 },
    Crypto: { builtins: [], cpu: 0n, memory: 0n, count: 0 },
    List: { builtins: [], cpu: 0n, memory: 0n, count: 0 },
    Data: { builtins: [], cpu: 0n, memory: 0n, count: 0 },
    Control: { builtins: [], cpu: 0n, memory: 0n, count: 0 },
    BLS: { builtins: [], cpu: 0n, memory: 0n, count: 0 },
    Pair: { builtins: [], cpu: 0n, memory: 0n, count: 0 },
    Other: { builtins: [], cpu: 0n, memory: 0n, count: 0 },
  };

  for (const [builtin, count] of Object.entries(builtinCounts)) {
    if (count === 0) continue;

    const cpuCost = (cpuMap[builtin] ?? 100000n) * BigInt(count);
    const memCost = (memMap[builtin] ?? 32n) * BigInt(count);

    totalCpu += cpuCost;
    totalMemory += memCost;

    const category = categorizeBuiltin(builtin);
    categories[category].cpu += cpuCost;
    categories[category].memory += memCost;
    categories[category].count += count;
    categories[category].builtins.push(builtin);
  }

  const breakdown: CostEstimate['breakdown'] = [];
  for (const [name, data] of Object.entries(categories)) {
    if (data.count > 0) {
      breakdown.push({
        category: name,
        cpu: data.cpu,
        memory: data.memory,
        count: data.count,
        builtins: data.builtins,
      });
    }
  }

  // Add CEK machine overhead if AST stats available
  if (astStats) {
    const machine = estimateMachineCost(astStats, machineCosts ?? DEFAULT_MACHINE_COSTS);
    totalCpu += machine.cpu;
    totalMemory += machine.memory;

    breakdown.push({
      category: 'Machine',
      cpu: machine.cpu,
      memory: machine.memory,
      count: machine.steps,
      builtins: ['CEK steps'],
    });
  }

  breakdown.sort((a, b) => Number(b.cpu - a.cpu));

  return {
    cpu: totalCpu,
    memory: totalMemory,
    total: totalCpu + totalMemory * 1000n,
    breakdown,
    budgetPercent: {
      cpu: Number((totalCpu * 10000n) / TX_BUDGET.cpu) / 100,
      memory: Number((totalMemory * 10000n) / TX_BUDGET.memory) / 100,
    },
  };
}

function categorizeBuiltin(name: string): string {
  if (name.includes('Integer') || name === 'modInteger' || name === 'quotientInteger' || name === 'remainderInteger' || name === 'divideInteger') {
    return 'Integer';
  }
  if (name.includes('ByteString') || name.includes('Byte') || name.includes('Bit') || name === 'readBit' || name === 'writeBits') {
    return 'ByteString';
  }
  if (name.includes('sha') || name.includes('blake') || name.includes('keccak') ||
      name.includes('verify') || name.includes('ripemd')) {
    return 'Crypto';
  }
  if (name.includes('bls12')) {
    return 'BLS';
  }
  if (name === 'headList' || name === 'tailList' || name === 'mkCons' || name === 'nullList' || name === 'chooseList') {
    return 'List';
  }
  if (name === 'fstPair' || name === 'sndPair' || name === 'mkPairData') {
    return 'Pair';
  }
  if (name.includes('Data') || name.includes('Constr') || name.includes('Map') ||
      name === 'iData' || name === 'bData' || name === 'unIData' || name === 'unBData' ||
      name === 'listData' || name === 'unListData' || name === 'mapData' || name === 'unMapData' ||
      name === 'mkNilData' || name === 'mkNilPairData') {
    return 'Data';
  }
  if (name === 'ifThenElse' || name === 'chooseUnit' || name === 'chooseData' || name === 'trace' || name === 'error') {
    return 'Control';
  }
  return 'Other';
}

export function getCostWarnings(builtinCounts: Record<string, number>): string[] {
  const warnings: string[] = [];

  for (const [name, count] of Object.entries(builtinCounts)) {
    if (count === 0) continue;

    if (name.includes('bls12')) {
      warnings.push(`BLS12-381 operations detected (${name}: ${count}×) — very expensive`);
    }
    if (name === 'verifyEd25519Signature' && count > 3) {
      warnings.push(`Multiple signature verifications (${count}×) — consider batching`);
    }
    if (name.includes('sha3') || name.includes('keccak')) {
      warnings.push(`SHA3/Keccak hashing (${count}×) — Blake2b is cheaper`);
    }
    if (name === 'serialiseData' && count > 5) {
      warnings.push(`Heavy data serialization (${count}×) — expensive in CPU`);
    }
  }

  return warnings;
}

// ──────────────────────────────────────────────
// Dynamic cost model (fetched from Plutus repo)
// ──────────────────────────────────────────────

/** Raw cost model entry from builtinCostModelA.json */
interface CostModelEntry {
  arguments: number | { intercept?: number; slope?: number; slope1?: number; slope2?: number; constant?: number; c0?: number; c1?: number; c2?: number; minimum?: number; model?: any };
  type: string;
}

/** Typical argument sizes for variable-cost builtins */
function getTypicalSize(builtin: string): number {
  if (builtin.includes('Integer') || builtin === 'modInteger' || builtin === 'divideInteger' ||
      builtin === 'quotientInteger' || builtin === 'remainderInteger') return TYPICAL_INT_SIZE;
  if (builtin.includes('ByteString') || builtin.includes('Byte') || builtin.includes('Bit') ||
      builtin.includes('sha') || builtin.includes('blake') || builtin.includes('keccak') ||
      builtin.includes('ripemd') || builtin.includes('verify') || builtin.includes('bls12')) return TYPICAL_BS_SIZE;
  if (builtin.includes('String') || builtin === 'encodeUtf8' || builtin === 'decodeUtf8') return TYPICAL_STRING_SIZE;
  if (builtin.includes('Data') || builtin.includes('Constr') || builtin === 'serialiseData') return TYPICAL_DATA_SIZE;
  return 4; // default
}

/** Evaluate a single cost model entry to a concrete value */
function evaluateCostEntry(entry: CostModelEntry, typicalSize: number): bigint {
  const args = entry.arguments;

  if (entry.type === 'constant_cost') {
    return BigInt(args as number);
  }

  if (typeof args === 'number') {
    return BigInt(args);
  }

  const a = args as Record<string, any>;

  switch (entry.type) {
    case 'linear_in_x':
    case 'linear_in_y':
    case 'linear_in_z':
    case 'linear_in_u':
    case 'max_size':
    case 'min_size':
      return BigInt(Math.max(0, Math.round((a.intercept ?? 0) + (a.slope ?? 0) * typicalSize)));

    case 'added_sizes':
      return BigInt(Math.max(0, Math.round((a.intercept ?? 0) + (a.slope ?? 0) * typicalSize * 2)));

    case 'subtracted_sizes':
      return BigInt(Math.max(a.minimum ?? 1, Math.round((a.intercept ?? 0) + (a.slope ?? 0) * 0)));

    case 'multiplied_sizes':
      return BigInt(Math.max(0, Math.round((a.intercept ?? 0) + (a.slope ?? 0) * typicalSize * typicalSize)));

    case 'const_above_diagonal':
      return BigInt(a.constant ?? 100000);

    case 'linear_on_diagonal': {
      // Typically same-size args → uses linear model
      const linearCost = (a.intercept ?? 0) + (a.slope ?? 0) * typicalSize;
      return BigInt(Math.max(0, Math.round(Math.min(a.constant ?? linearCost, linearCost))));
    }

    case 'quadratic_in_y':
    case 'quadratic_in_z':
    case 'quadratic_in_x':
      return BigInt(Math.max(0, Math.round(
        (a.c0 ?? 0) + (a.c1 ?? 0) * typicalSize + (a.c2 ?? 0) * typicalSize * typicalSize
      )));

    case 'linear_in_y_and_z':
      return BigInt(Math.max(0, Math.round(
        (a.intercept ?? 0) + (a.slope1 ?? 0) * typicalSize + (a.slope2 ?? 0) * typicalSize
      )));

    case 'linear_in_max_yz':
      return BigInt(Math.max(0, Math.round((a.intercept ?? 0) + (a.slope ?? 0) * typicalSize)));

    case 'literal_in_y_or_linear_in_z':
      return BigInt(Math.max(0, Math.round((a.intercept ?? 0) + (a.slope ?? 0) * typicalSize)));

    case 'exp_mod_cost':
      // Complex model — use rough estimate
      return BigInt(Math.round((a.coefficient00 ?? 0) + (a.coefficient11 ?? 0) * typicalSize));

    case 'with_interaction_in_x_and_y':
      return BigInt(Math.max(0, Math.round(
        (a.c00 ?? 0) + (a.c01 ?? 0) * typicalSize + (a.c10 ?? 0) * typicalSize + (a.c11 ?? 0) * typicalSize * typicalSize
      )));

    default:
      return 100000n;
  }
}

/**
 * Parse a Plutus cost model JSON (builtinCostModelA.json format)
 * into CPU and memory cost maps usable by `estimateCost()`.
 */
export function parseCostModelJSON(
  json: Record<string, { cpu: CostModelEntry; memory: CostModelEntry }>
): { cpuCosts: Record<string, bigint>; memCosts: Record<string, bigint> } {
  const cpuCosts: Record<string, bigint> = {};
  const memCosts: Record<string, bigint> = {};

  for (const [builtin, model] of Object.entries(json)) {
    const size = getTypicalSize(builtin);
    try {
      cpuCosts[builtin] = evaluateCostEntry(model.cpu, size);
      memCosts[builtin] = evaluateCostEntry(model.memory, size);
    } catch {
      // Skip builtins we can't parse — fallback handled in estimateCost
    }
  }

  return { cpuCosts, memCosts };
}

// End of costs module
