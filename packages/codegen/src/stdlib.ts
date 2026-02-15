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
  /** Expected number of runtime arguments (for currying excess args) */
  arity?: number;
}

/**
 * Map UPLC builtins to Aiken stdlib
 */
export const BUILTIN_MAP: Record<string, BuiltinMapping> = {
  // List operations → aiken/builtin (decompiled code is untyped, method syntax fails on Data)
  headList: { module: 'aiken/builtin', aikenName: 'head_list', arity: 1 },
  tailList: { module: 'aiken/builtin', aikenName: 'tail_list', arity: 1 },
  nullList: { module: 'aiken/builtin', aikenName: 'null_list', arity: 1 },
  mkCons: { module: 'aiken/collection/list', inline: '[{0}, ..{1}]' },
  
  // Pair operations → builtin function calls
  fstPair: { module: 'aiken/builtin', aikenName: 'fst_pair', arity: 1 },
  sndPair: { module: 'aiken/builtin', aikenName: 'snd_pair', arity: 1 },
  mkPairData: { inline: 'Pair({0}, {1})' },
  
  // Data operations → builtin calls for proper typing
  unConstrData: { module: 'aiken/builtin', inline: 'builtin.un_constr_data({0})' },
  constrData: { module: 'aiken/builtin', aikenName: 'constr_data', inline: 'builtin.constr_data({0}, {1})' },
  unIData: { module: 'aiken/builtin', inline: 'builtin.un_i_data({0})' },
  iData: { module: 'aiken/builtin', inline: 'builtin.i_data({0})' },
  unBData: { module: 'aiken/builtin', inline: 'builtin.un_b_data({0})' },
  bData: { module: 'aiken/builtin', inline: 'builtin.b_data({0})' },
  unListData: { module: 'aiken/builtin', inline: 'builtin.un_list_data({0})' },
  listData: { module: 'aiken/builtin', inline: 'builtin.list_data({0})' },
  unMapData: { module: 'aiken/builtin', inline: 'builtin.un_map_data({0})' },
  mapData: { module: 'aiken/builtin', inline: 'builtin.map_data({0})' },
  
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
  appendByteString: { module: 'aiken/builtin', aikenName: 'append_bytearray' },
  consByteString: { module: 'aiken/builtin', aikenName: 'cons_bytearray' },
  sliceByteString: { module: 'aiken/builtin', aikenName: 'slice_bytearray' },
  lengthOfByteString: { module: 'aiken/builtin', aikenName: 'length_of_bytearray', arity: 1 },
  indexByteString: { module: 'aiken/builtin', aikenName: 'index_bytearray' },
  equalsByteString: { module: 'aiken/builtin', aikenName: 'equals_bytearray', inline: 'builtin.equals_bytearray({0}, {1})' },
  lessThanByteString: { module: 'aiken/builtin', aikenName: 'less_than_bytearray', inline: 'builtin.less_than_bytearray({0}, {1})' },
  lessThanEqualsByteString: { module: 'aiken/builtin', aikenName: 'less_than_equals_bytearray', inline: 'builtin.less_than_equals_bytearray({0}, {1})' },
  
  // String operations
  appendString: { inline: '{0} <> {1}' },
  equalsString: { module: 'aiken/builtin', aikenName: 'equals_string', inline: 'builtin.equals_string({0}, {1})' },
  encodeUtf8: { module: 'aiken/builtin', aikenName: 'encode_utf8' },
  decodeUtf8: { module: 'aiken/builtin', aikenName: 'decode_utf8' },
  
  // Crypto → aiken/crypto
  sha2_256: { module: 'aiken/crypto', aikenName: 'sha2_256' },
  sha3_256: { module: 'aiken/crypto', aikenName: 'sha3_256' },
  blake2b_256: { module: 'aiken/crypto', aikenName: 'blake2b_256' },
  blake2b_224: { module: 'aiken/crypto', aikenName: 'blake2b_224' },
  keccak_256: { module: 'aiken/crypto', aikenName: 'keccak_256' },
  verifyEd25519Signature: { module: 'aiken/builtin', aikenName: 'verify_ed25519_signature' },
  verifyEcdsaSecp256k1Signature: { module: 'aiken/builtin', aikenName: 'verify_ecdsa_secp256k1_signature' },
  verifySchnorrSecp256k1Signature: { module: 'aiken/builtin', aikenName: 'verify_schnorr_secp256k1_signature' },
  
  // Boolean
  ifThenElse: { inline: 'if {0} { {1} } else { {2} }' },
  
  // Trace (debug)
  trace: { inline: 'trace @"{0}": {1}' },
  
  // Error
  error: { inline: 'fail' },
  
  // Choose operations (polymorphic dispatch)
  chooseUnit: { inline: '{1}' },  // Returns second arg when unit
  chooseList: { module: 'aiken/builtin', inline: 'if builtin.null_list({0}) { {1} } else { {2} }' },
  chooseData: { module: 'aiken/builtin', inline: 'builtin.choose_data({0}, {1}, {2}, {3}, {4}, {5})' },
  
  // Data equality
  equalsData: { inline: '{0} == {1}' },
  
  // Nil constructors
  mkNilData: { inline: '[]' },
  mkNilPairData: { inline: '[]' },
  
  // Serialization
  serialiseData: { module: 'aiken/builtin', aikenName: 'serialise_data' },
  
  // Integer/ByteString conversion (Plutus V3)
  integerToByteString: { module: 'aiken/builtin', aikenName: 'integer_to_bytearray' },
  byteStringToInteger: { module: 'aiken/builtin', aikenName: 'bytearray_to_integer' },
  
  // Bitwise operations (Plutus V3)
  andByteString: { module: 'aiken/builtin', aikenName: 'and_bytearray' },
  orByteString: { module: 'aiken/builtin', aikenName: 'or_bytearray' },
  xorByteString: { module: 'aiken/builtin', aikenName: 'xor_bytearray' },
  complementByteString: { module: 'aiken/builtin', aikenName: 'complement_bytearray' },
  readBit: { module: 'aiken/builtin', aikenName: 'read_bit' },
  writeBits: { module: 'aiken/builtin', aikenName: 'write_bits' },
  replicateByte: { module: 'aiken/builtin', aikenName: 'replicate_byte' },
  shiftByteString: { module: 'aiken/builtin', aikenName: 'shift_bytearray' },
  rotateByteString: { module: 'aiken/builtin', aikenName: 'rotate_bytearray' },
  countSetBits: { module: 'aiken/builtin', aikenName: 'count_set_bits' },
  findFirstSetBit: { module: 'aiken/builtin', aikenName: 'find_first_set_bit' },
  
  // Additional crypto
  ripemd_160: { module: 'aiken/crypto', aikenName: 'ripemd_160' },
  
  // BLS (Plutus V3)
  // BLS12-381 — use builtin module for untyped decompiled code
  bls12_381_G1_add: { module: 'aiken/builtin', aikenName: 'bls12_381_g1_add' },
  bls12_381_G1_neg: { module: 'aiken/builtin', aikenName: 'bls12_381_g1_neg' },
  bls12_381_G1_scalarMul: { module: 'aiken/builtin', aikenName: 'bls12_381_g1_scalar_mul' },
  bls12_381_G1_equal: { module: 'aiken/builtin', aikenName: 'bls12_381_g1_equal' },
  bls12_381_G1_hashToGroup: { module: 'aiken/builtin', aikenName: 'bls12_381_g1_hash_to_group' },
  bls12_381_G1_compress: { module: 'aiken/builtin', aikenName: 'bls12_381_g1_compress' },
  bls12_381_G1_uncompress: { module: 'aiken/builtin', aikenName: 'bls12_381_g1_uncompress' },
  bls12_381_G2_add: { module: 'aiken/builtin', aikenName: 'bls12_381_g2_add' },
  bls12_381_G2_neg: { module: 'aiken/builtin', aikenName: 'bls12_381_g2_neg' },
  bls12_381_G2_scalarMul: { module: 'aiken/builtin', aikenName: 'bls12_381_g2_scalar_mul' },
  bls12_381_G2_equal: { module: 'aiken/builtin', aikenName: 'bls12_381_g2_equal' },
  bls12_381_G2_hashToGroup: { module: 'aiken/builtin', aikenName: 'bls12_381_g2_hash_to_group' },
  bls12_381_G2_compress: { module: 'aiken/builtin', aikenName: 'bls12_381_g2_compress' },
  bls12_381_G2_uncompress: { module: 'aiken/builtin', aikenName: 'bls12_381_g2_uncompress' },
  bls12_381_millerLoop: { module: 'aiken/builtin', aikenName: 'bls12_381_miller_loop' },
  bls12_381_mulMlResult: { module: 'aiken/builtin', aikenName: 'bls12_381_mul_miller_loop_result' },
  bls12_381_finalVerify: { module: 'aiken/builtin', aikenName: 'bls12_381_final_verify' },
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
