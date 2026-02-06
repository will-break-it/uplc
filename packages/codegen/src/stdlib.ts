/**
 * Aiken Standard Library Mapping
 * 
 * Maps UPLC builtins to Aiken stdlib imports and idiomatic code.
 */

export interface BuiltinMapping {
  /** Aiken module to import */
  module?: string;
  /** Aiken function name (if different from builtin) */
  aikenName?: string;
  /** Inline expression template (for simple ops) */
  inline?: string;
  /** Whether this is a method call style */
  method?: boolean;
}

/**
 * Map UPLC builtins to Aiken stdlib
 */
export const BUILTIN_MAP: Record<string, BuiltinMapping> = {
  // List operations → aiken/list
  headList: { module: 'aiken/list', aikenName: 'head', method: true },
  tailList: { module: 'aiken/list', aikenName: 'tail', method: true },
  nullList: { module: 'aiken/list', aikenName: 'is_empty', method: true },
  mkCons: { module: 'aiken/list', inline: '[{0}, ..{1}]' },
  
  // Pair operations → tuple access
  fstPair: { inline: '{0}.1st' },
  sndPair: { inline: '{0}.2nd' },
  mkPairData: { inline: 'Pair({0}, {1})' },
  
  // Data operations → pattern matching (usually inlined)
  unConstrData: { inline: '{0}' },  // Becomes pattern match
  constrData: { inline: '{0} {{ {1} }}' },
  unIData: { inline: '{0}' },
  iData: { inline: '{0}' },
  unBData: { inline: '{0}' },
  bData: { inline: '{0}' },
  unListData: { inline: '{0}' },
  listData: { inline: '{0}' },
  unMapData: { inline: '{0}' },
  mapData: { inline: '{0}' },
  
  // Integer operations → native
  addInteger: { inline: '{0} + {1}' },
  subtractInteger: { inline: '{0} - {1}' },
  multiplyInteger: { inline: '{0} * {1}' },
  divideInteger: { inline: '{0} / {1}' },
  modInteger: { inline: '{0} % {1}' },
  quotientInteger: { inline: '{0} / {1}' },
  remainderInteger: { inline: '{0} % {1}' },
  equalsInteger: { inline: '{0} == {1}' },
  lessThanInteger: { inline: '{0} < {1}' },
  lessThanEqualsInteger: { inline: '{0} <= {1}' },
  
  // ByteArray operations → aiken/bytearray or native
  appendByteString: { module: 'aiken/bytearray', aikenName: 'concat', method: true },
  consByteString: { module: 'aiken/bytearray', aikenName: 'push', method: true },
  sliceByteString: { module: 'aiken/bytearray', aikenName: 'slice', method: true },
  lengthOfByteString: { module: 'aiken/bytearray', aikenName: 'length', method: true },
  indexByteString: { module: 'aiken/bytearray', aikenName: 'at', method: true },
  equalsByteString: { inline: '{0} == {1}' },
  lessThanByteString: { inline: '{0} < {1}' },
  lessThanEqualsByteString: { inline: '{0} <= {1}' },
  
  // String operations
  appendString: { inline: '{0} <> {1}' },
  equalsString: { inline: '{0} == {1}' },
  encodeUtf8: { module: 'aiken/bytearray', aikenName: 'from_string' },
  decodeUtf8: { module: 'aiken/bytearray', aikenName: 'to_string', method: true },
  
  // Crypto → aiken/crypto
  sha2_256: { module: 'aiken/crypto', aikenName: 'sha2_256' },
  sha3_256: { module: 'aiken/crypto', aikenName: 'sha3_256' },
  blake2b_256: { module: 'aiken/crypto', aikenName: 'blake2b_256' },
  blake2b_224: { module: 'aiken/crypto', aikenName: 'blake2b_224' },
  keccak_256: { module: 'aiken/crypto', aikenName: 'keccak_256' },
  verifyEd25519Signature: { module: 'aiken/crypto', aikenName: 'verify_signature' },
  verifyEcdsaSecp256k1Signature: { module: 'aiken/crypto', aikenName: 'verify_ecdsa_signature' },
  verifySchnorrSecp256k1Signature: { module: 'aiken/crypto', aikenName: 'verify_schnorr_signature' },
  
  // Boolean
  ifThenElse: { inline: 'if {0} {{ {1} }} else {{ {2} }}' },
  
  // Trace (debug)
  trace: { inline: 'trace @"{0}": {1}' },
  
  // Error
  error: { inline: 'fail' },
  
  // Serialization
  serialiseData: { module: 'aiken/cbor', aikenName: 'serialise' },
  
  // BLS (Plutus V3)
  bls12_381_G1_add: { module: 'aiken/crypto/bls12_381', aikenName: 'g1_add' },
  bls12_381_G1_neg: { module: 'aiken/crypto/bls12_381', aikenName: 'g1_neg' },
  bls12_381_G1_scalarMul: { module: 'aiken/crypto/bls12_381', aikenName: 'g1_scalar_mul' },
  bls12_381_G1_equal: { module: 'aiken/crypto/bls12_381', aikenName: 'g1_equal' },
  bls12_381_G1_compress: { module: 'aiken/crypto/bls12_381', aikenName: 'g1_compress' },
  bls12_381_G1_uncompress: { module: 'aiken/crypto/bls12_381', aikenName: 'g1_uncompress' },
  bls12_381_G2_add: { module: 'aiken/crypto/bls12_381', aikenName: 'g2_add' },
  bls12_381_G2_neg: { module: 'aiken/crypto/bls12_381', aikenName: 'g2_neg' },
  bls12_381_G2_scalarMul: { module: 'aiken/crypto/bls12_381', aikenName: 'g2_scalar_mul' },
  bls12_381_G2_equal: { module: 'aiken/crypto/bls12_381', aikenName: 'g2_equal' },
  bls12_381_G2_compress: { module: 'aiken/crypto/bls12_381', aikenName: 'g2_compress' },
  bls12_381_G2_uncompress: { module: 'aiken/crypto/bls12_381', aikenName: 'g2_uncompress' },
  bls12_381_millerLoop: { module: 'aiken/crypto/bls12_381', aikenName: 'miller_loop' },
  bls12_381_mulMlResult: { module: 'aiken/crypto/bls12_381', aikenName: 'mul_ml_result' },
  bls12_381_finalVerify: { module: 'aiken/crypto/bls12_381', aikenName: 'final_verify' },
};

/**
 * Get required imports from a list of used builtins
 */
export function getRequiredImports(usedBuiltins: string[]): string[] {
  const modules = new Set<string>();
  
  for (const builtin of usedBuiltins) {
    const mapping = BUILTIN_MAP[builtin];
    if (mapping?.module) {
      modules.add(mapping.module);
    }
  }
  
  return Array.from(modules).sort();
}

/**
 * Convert a builtin call to Aiken syntax
 */
export function builtinToAiken(name: string, args: string[]): string {
  const mapping = BUILTIN_MAP[name];
  
  if (!mapping) {
    // Unknown builtin - use as-is with warning comment
    return `/* unknown: ${name} */ ${name}(${args.join(', ')})`;
  }
  
  if (mapping.inline) {
    // Replace placeholders with args
    let result = mapping.inline;
    args.forEach((arg, i) => {
      result = result.replace(new RegExp(`\\{${i}\\}`, 'g'), arg);
    });
    return result;
  }
  
  const fnName = mapping.aikenName || name;
  
  if (mapping.method && args.length > 0) {
    // Method call style: list.head()
    const [first, ...rest] = args;
    return rest.length > 0 
      ? `${first}.${fnName}(${rest.join(', ')})`
      : `${first}.${fnName}()`;
  }
  
  // Regular function call
  return `${fnName}(${args.join(', ')})`;
}
