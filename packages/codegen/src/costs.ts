/**
 * Plutus Cost Model
 * 
 * Estimates execution costs based on builtin usage.
 * Costs are in abstract units (ExUnits = CPU + Memory).
 * 
 * Based on Plutus V3 cost model from Cardano mainnet.
 * These are base costs - actual costs depend on arguments.
 */

export interface CostEstimate {
  /** CPU cost in abstract units */
  cpu: bigint;
  /** Memory cost in abstract units */
  memory: bigint;
  /** Total cost (weighted combination) */
  total: bigint;
  /** Breakdown by category */
  breakdown: {
    category: string;
    cpu: bigint;
    memory: bigint;
    count: number;
  }[];
  /** Estimated as percentage of typical tx budget */
  budgetPercent: {
    cpu: number;
    memory: number;
  };
}

/**
 * Base CPU costs per builtin (Plutus V3 mainnet model)
 * Values are approximate base costs
 */
export const BUILTIN_CPU_COSTS: Record<string, bigint> = {
  // Integer operations
  addInteger: 205665n,
  subtractInteger: 205665n,
  multiplyInteger: 69522n,
  divideInteger: 196500n,
  quotientInteger: 196500n,
  remainderInteger: 196500n,
  modInteger: 196500n,
  equalsInteger: 208512n,
  lessThanInteger: 208512n,
  lessThanEqualsInteger: 208512n,
  
  // ByteString operations
  appendByteString: 1000n,
  consByteString: 150000n,
  sliceByteString: 150000n,
  lengthOfByteString: 150000n,
  indexByteString: 150000n,
  equalsByteString: 150000n,
  lessThanByteString: 150000n,
  lessThanEqualsByteString: 150000n,
  
  // Crypto (expensive!)
  sha2_256: 806990n,
  sha3_256: 1927926n,
  blake2b_256: 201305n,
  blake2b_224: 201305n,
  keccak_256: 1927926n,
  ripemd_160: 806990n,
  verifyEd25519Signature: 53384111n,
  verifyEcdsaSecp256k1Signature: 35892428n,
  verifySchnorrSecp256k1Signature: 38916450n,
  
  // String operations
  appendString: 1000n,
  equalsString: 150000n,
  encodeUtf8: 150000n,
  decodeUtf8: 150000n,
  
  // Control flow
  ifThenElse: 80556n,
  chooseUnit: 46417n,
  chooseList: 150000n,
  chooseData: 150000n,
  trace: 150000n,
  
  // Pair operations
  fstPair: 80436n,
  sndPair: 80436n,
  mkPairData: 150000n,
  
  // List operations
  mkCons: 150000n,
  headList: 150000n,
  tailList: 150000n,
  nullList: 150000n,
  
  // Data operations
  constrData: 150000n,
  mapData: 150000n,
  listData: 150000n,
  iData: 150000n,
  bData: 150000n,
  unConstrData: 150000n,
  unMapData: 150000n,
  unListData: 150000n,
  unIData: 150000n,
  unBData: 150000n,
  equalsData: 150000n,
  mkNilData: 150000n,
  mkNilPairData: 150000n,
  serialiseData: 150000n,
  
  // BLS12-381 (very expensive!)
  bls12_381_G1_add: 962126n,
  bls12_381_G1_neg: 267929n,
  bls12_381_G1_scalarMul: 76433006n,
  bls12_381_G1_equal: 545063n,
  bls12_381_G1_hashToGroup: 66311195n,
  bls12_381_G1_compress: 3227919n,
  bls12_381_G1_uncompress: 16598737n,
  bls12_381_G2_add: 2117323n,
  bls12_381_G2_neg: 344963n,
  bls12_381_G2_scalarMul: 219393451n,
  bls12_381_G2_equal: 901022n,
  bls12_381_G2_hashToGroup: 204557793n,
  bls12_381_G2_compress: 3948421n,
  bls12_381_G2_uncompress: 33114723n,
  bls12_381_millerLoop: 284097484n,
  bls12_381_mulMlResult: 2174318n,
  bls12_381_finalVerify: 388656972n,
  
  // Bitwise (Plutus V3)
  integerToByteString: 1000n,
  byteStringToInteger: 1000n,
  andByteString: 150000n,
  orByteString: 150000n,
  xorByteString: 150000n,
  complementByteString: 150000n,
  readBit: 150000n,
  writeBits: 150000n,
  replicateByte: 150000n,
  shiftByteString: 150000n,
  rotateByteString: 150000n,
  countSetBits: 150000n,
  findFirstSetBit: 150000n,
};

/**
 * Memory costs per builtin (simplified)
 */
export const BUILTIN_MEMORY_COSTS: Record<string, bigint> = {
  // Most operations have minimal base memory cost
  // Actual cost depends on data sizes
  addInteger: 1n,
  subtractInteger: 1n,
  multiplyInteger: 1n,
  divideInteger: 1n,
  sha2_256: 4n,
  sha3_256: 4n,
  blake2b_256: 4n,
  verifyEd25519Signature: 10n,
  appendByteString: 1n,
  appendString: 1n,
  ifThenElse: 1n,
  // ... defaults to 1
};

/**
 * Typical transaction budget limits (mainnet)
 */
export const TX_BUDGET = {
  cpu: 10000000000n,  // 10 billion
  memory: 10000000n,  // 10 million
};

/**
 * Estimate execution cost from builtin counts
 */
export function estimateCost(builtinCounts: Record<string, number>): CostEstimate {
  let totalCpu = 0n;
  let totalMemory = 0n;
  
  const breakdown: CostEstimate['breakdown'] = [];
  
  // Group by category
  const categories: Record<string, { builtins: string[], cpu: bigint, memory: bigint, count: number }> = {
    'Integer': { builtins: [], cpu: 0n, memory: 0n, count: 0 },
    'ByteString': { builtins: [], cpu: 0n, memory: 0n, count: 0 },
    'Crypto': { builtins: [], cpu: 0n, memory: 0n, count: 0 },
    'List': { builtins: [], cpu: 0n, memory: 0n, count: 0 },
    'Data': { builtins: [], cpu: 0n, memory: 0n, count: 0 },
    'Control': { builtins: [], cpu: 0n, memory: 0n, count: 0 },
    'BLS': { builtins: [], cpu: 0n, memory: 0n, count: 0 },
    'Other': { builtins: [], cpu: 0n, memory: 0n, count: 0 },
  };
  
  for (const [builtin, count] of Object.entries(builtinCounts)) {
    if (count === 0) continue;
    
    const cpuCost = (BUILTIN_CPU_COSTS[builtin] || 100000n) * BigInt(count);
    const memCost = (BUILTIN_MEMORY_COSTS[builtin] || 1n) * BigInt(count);
    
    totalCpu += cpuCost;
    totalMemory += memCost;
    
    const category = categorizeBuiltin(builtin);
    categories[category].cpu += cpuCost;
    categories[category].memory += memCost;
    categories[category].count += count;
    categories[category].builtins.push(builtin);
  }
  
  // Build breakdown
  for (const [name, data] of Object.entries(categories)) {
    if (data.count > 0) {
      breakdown.push({
        category: name,
        cpu: data.cpu,
        memory: data.memory,
        count: data.count,
      });
    }
  }
  
  // Sort by CPU cost
  breakdown.sort((a, b) => Number(b.cpu - a.cpu));
  
  return {
    cpu: totalCpu,
    memory: totalMemory,
    total: totalCpu + totalMemory * 1000n,  // Weighted combination
    breakdown,
    budgetPercent: {
      cpu: Number((totalCpu * 100n) / TX_BUDGET.cpu),
      memory: Number((totalMemory * 100n) / TX_BUDGET.memory),
    },
  };
}

/**
 * Categorize a builtin for grouping
 */
function categorizeBuiltin(name: string): string {
  if (name.includes('Integer') || name.includes('Mod') || name.includes('Quotient') || name.includes('Remainder')) {
    return 'Integer';
  }
  if (name.includes('ByteString') || name.includes('Byte') || name.includes('Bit')) {
    return 'ByteString';
  }
  if (name.includes('sha') || name.includes('blake') || name.includes('keccak') || 
      name.includes('verify') || name.includes('ripemd')) {
    return 'Crypto';
  }
  if (name.includes('bls12')) {
    return 'BLS';
  }
  if (name.includes('List') || name.includes('Cons') || name.includes('head') || name.includes('tail')) {
    return 'List';
  }
  if (name.includes('Data') || name.includes('Constr') || name.includes('Map') || 
      name.includes('iData') || name.includes('bData') || name.includes('unI') || name.includes('unB')) {
    return 'Data';
  }
  if (name.includes('if') || name.includes('choose') || name.includes('trace') || name === 'error') {
    return 'Control';
  }
  return 'Other';
}

/**
 * Format cost for display
 */
export function formatCost(cost: CostEstimate): string {
  const cpuM = Number(cost.cpu / 1000000n);
  const memK = Number(cost.memory / 1000n);
  
  return `CPU: ${cpuM.toFixed(1)}M (${cost.budgetPercent.cpu.toFixed(1)}% of budget)\n` +
         `Memory: ${memK.toFixed(1)}K (${cost.budgetPercent.memory.toFixed(1)}% of budget)`;
}

/**
 * Get cost warnings for expensive operations
 */
export function getCostWarnings(builtinCounts: Record<string, number>): string[] {
  const warnings: string[] = [];
  
  // Check for expensive crypto
  for (const [name, count] of Object.entries(builtinCounts)) {
    if (count === 0) continue;
    
    if (name.includes('bls12') && count > 0) {
      warnings.push(`BLS12-381 operations detected (${name}: ${count}x) - very expensive`);
    }
    if (name === 'verifyEd25519Signature' && count > 3) {
      warnings.push(`Multiple signature verifications (${count}x) - consider batching`);
    }
    if (name.includes('sha3') || name.includes('keccak')) {
      warnings.push(`SHA3/Keccak hashing used - SHA256 or Blake2b is cheaper`);
    }
  }
  
  return warnings;
}
