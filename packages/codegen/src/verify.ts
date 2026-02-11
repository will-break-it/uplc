/**
 * Verification module for decompiled Aiken code quality
 * 
 * Compares decompiled code against ground-truth constants from UPLC bytecode
 * to assess confidence in the decompilation quality.
 */

export interface VerificationResult {
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

export interface UplcConstants {
  bytestrings: string[];
  integers: string[];
}

// Aiken stdlib functions that are safe to reference without definition
const AIKEN_STDLIB = new Set([
  // list module
  'list.find', 'list.at', 'list.head', 'list.tail', 'list.filter', 'list.map',
  'list.foldl', 'list.foldr', 'list.any', 'list.all', 'list.length', 'list.concat',
  'list.push', 'list.reverse', 'list.drop', 'list.take', 'list.zip', 'list.indexed_map',
  'list.unique', 'list.flatten', 'list.span', 'list.has', 'list.index_of', 'list.is_empty',
  // value module
  'value.to_dict', 'value.from_dict', 'value.merge', 'value.lovelace_of', 'value.quantity_of',
  'value.tokens', 'value.policies', 'value.flatten', 'value.zero', 'value.add',
  'value.negate', 'value.from_asset', 'value.from_lovelace', 'value.without_lovelace',
  // dict module
  'dict.get', 'dict.has_key', 'dict.insert', 'dict.delete', 'dict.keys', 'dict.values',
  'dict.to_pairs', 'dict.from_pairs', 'dict.union', 'dict.filter', 'dict.map', 'dict.foldl',
  'dict.foldr', 'dict.empty', 'dict.size', 'dict.is_empty',
  // bytearray module
  'bytearray.concat', 'bytearray.push', 'bytearray.length', 'bytearray.take',
  'bytearray.drop', 'bytearray.slice', 'bytearray.index_of', 'bytearray.is_empty',
  'bytearray.test_bit', 'bytearray.from_string', 'bytearray.to_hex', 'bytearray.from_int',
  // string module
  'string.concat', 'string.from_bytearray', 'string.from_int', 'string.to_bytearray',
  // math module
  'math.abs', 'math.max', 'math.min', 'math.clamp', 'math.pow', 'math.sqrt', 'math.log',
  // option module
  'option.map', 'option.and_then', 'option.or_else', 'option.is_some', 'option.is_none',
  'option.flatten', 'option.unwrap',
  // transaction helpers (common pattern)
  'tx.find_input', 'tx.find_output', 'tx.find_datum', 'tx.value_paid_to',
  'transaction.find_input', 'transaction.find_output',
  // interval module
  'interval.before', 'interval.after', 'interval.between', 'interval.contains',
  'interval.is_empty', 'interval.hull', 'interval.intersection',
  // cbor module
  'cbor.serialise', 'cbor.diagnostic',
  // hash module
  'hash.sha2_256', 'hash.sha3_256', 'hash.blake2b_224', 'hash.blake2b_256',
]);

// Type constructors that don't need definitions
const TYPE_CONSTRUCTORS = new Set([
  'Some', 'None', 'True', 'False', 'Ok', 'Err',
  'Void', 'Finite', 'Positive', 'Negative', 'NegativeInfinity', 'PositiveInfinity',
  'ScriptCredential', 'VerificationKeyCredential', 'Inline', 'Pointer',
  'Mint', 'Spend', 'Withdraw', 'Publish', 'NoDatum', 'DatumHash', 'InlineDatum',
  'Input', 'Output', 'Redeemer', 'TransactionId', 'OutputReference',
  'Constr', 'List', 'Map', 'Pair',
  // Lowercase type names (appear in type annotations like <list(pair)>)
  'list', 'pair', 'data', 'int', 'bool', 'string', 'bytestring', 'void',
]);

// Aiken keywords and builtins that aren't function definitions
const AIKEN_KEYWORDS = new Set([
  'fn', 'if', 'else', 'when', 'is', 'let', 'expect', 'fail', 'trace',
  'use', 'pub', 'type', 'opaque', 'const', 'validator', 'test', 'and', 'or',
  // Validator entry points
  'spend', 'mint', 'withdraw', 'publish', 'vote', 'propose',
]);

// Pattern: generated binding name (single letter, or letter + digits like b1, j2, a3)
const GENERATED_BINDING_RE = /^[a-z][0-9]*$/;

// Pattern: method call on a variable (e.g., b1.tail, p2.is_empty, z.tail)
const VARIABLE_METHOD_RE = /^[a-z][a-z0-9]*\.(tail|head|is_empty|length|1st|2nd)$/;

// Aiken builtins (builtin.xxx calls)
const BUILTIN_PREFIX = 'builtin.';

// Plutus builtins that AI sometimes writes with underscores instead of camelCase
const PLUTUS_BUILTINS = new Set([
  'un_constr_data', 'un_map_data', 'un_b_data', 'un_i_data', 'un_list_data',
  'mk_pair_data', 'mk_cons', 'mk_nil_data', 'mk_nil_pair_data',
  'list_data', 'map_data', 'constr_data', 'b_data', 'i_data',
  'head_list', 'tail_list', 'null_list', 'choose_list',
  'fst_pair', 'snd_pair', 'choose_data', 'choose_unit',
  'if_then_else', 'equals_data', 'equals_integer', 'equals_bytestring', 'equals_string',
  'less_than_integer', 'less_than_equals_integer', 'less_than_bytestring',
  'add_integer', 'subtract_integer', 'multiply_integer', 'divide_integer', 'mod_integer',
  'quotient_integer', 'remainder_integer',
  'append_bytestring', 'cons_bytestring', 'slice_bytestring', 'length_of_bytestring',
  'index_bytestring', 'sha2_256', 'sha3_256', 'blake2b_256', 'blake2b_224',
  'verify_ed25519_signature', 'verify_ecdsa_secp256k1_signature', 'verify_schnorr_secp256k1_signature',
  'append_string', 'encode_utf8', 'decode_utf8', 'trace',
  'serialise_data', 'mk_pair_data',
]);

/**
 * Try to decode hex bytestring to ASCII
 * Returns the decoded string if all bytes are printable ASCII, otherwise null
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
 * Check if a bytestring constant is present in the code
 * Searches for: raw hex, #"hex" literal, ASCII-decoded string in quotes
 */
function findBytestring(code: string, hex: string): boolean {
  // Skip trivially short bytestrings
  if (hex.length < 8) return true;
  
  // Direct hex search
  if (code.includes(hex)) return true;
  
  // Aiken hex literal format: #"hex"
  if (code.includes(`#"${hex}"`)) return true;
  
  // Try ASCII decode
  const ascii = hexToAscii(hex);
  if (ascii) {
    // Search for string in quotes
    if (code.includes(`"${ascii}"`)) return true;
    // Also check for the raw string (might appear in trace or comments)
    if (code.includes(ascii)) return true;
  }
  
  return false;
}

/**
 * Check if an integer constant is present in the code
 * Skips trivial values (0, 1) as they appear everywhere
 */
function findInteger(code: string, intStr: string): boolean {
  const val = parseInt(intStr);
  
  // Skip trivial integers - they're everywhere
  if (val === 0 || val === 1) return true;
  
  // For negative numbers, look for the minus sign before the digits
  // \b doesn't work with leading minus, so use lookbehind/lookahead
  if (intStr.startsWith('-')) {
    const regex = new RegExp(`(?<![0-9])${intStr.replace('-', '\\-')}(?![0-9])`);
    return regex.test(code);
  }
  
  // For positive numbers, word boundary match avoids false positives
  const regex = new RegExp(`\\b${intStr}\\b`);
  if (regex.test(code)) return true;
  
  // Check for absorption into semantic names:
  // is_constr_N, eq_N, get_field_N — these prove the integer N was in the bytecode
  const absVal = Math.abs(val).toString();
  if (code.includes(`is_constr_${absVal}`)) return true;
  if (code.includes(`eq_${absVal}`)) return true;
  if (code.includes(`get_field_${absVal}`)) return true;
  
  return false;
}

/**
 * Extract all function definitions from the code
 * Matches: fn name( or fn name<
 */
function extractDefinedFunctions(code: string): Set<string> {
  const defined = new Set<string>();
  
  // Match fn name( or fn name<T>(
  const fnRegex = /\bfn\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*[(<]/g;
  let match;
  while ((match = fnRegex.exec(code)) !== null) {
    defined.add(match[1]);
  }
  
  // Also match type/struct/enum definitions as they create constructors
  const typeRegex = /\b(?:type|pub\s+type)\s+([A-Z][a-zA-Z0-9_]*)/g;
  while ((match = typeRegex.exec(code)) !== null) {
    defined.add(match[1]);
  }
  
  return defined;
}

/**
 * Extract all function calls/references from the code
 * Filters out builtins, stdlib, type constructors, keywords, and generated bindings
 */
function extractFunctionCalls(code: string): Set<string> {
  const calls = new Set<string>();
  
  // Match name( but not fn name( and not .name(
  const callRegex = /(?<!fn\s)(?<![.a-zA-Z_])([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*\(/g;
  let match;
  while ((match = callRegex.exec(code)) !== null) {
    const name = match[1];
    
    // Skip builtins (builtin.xxx)
    if (name.startsWith(BUILTIN_PREFIX)) continue;
    
    // Skip stdlib functions
    if (AIKEN_STDLIB.has(name)) continue;
    
    // Skip type constructors
    if (TYPE_CONSTRUCTORS.has(name)) continue;
    
    // Skip Aiken keywords (fn, fail, spend, etc.)
    if (AIKEN_KEYWORDS.has(name)) continue;
    
    // Skip Plutus builtins written with underscores (AI variant)
    if (PLUTUS_BUILTINS.has(name)) continue;
    
    // Skip generated binding names (single letter or letter+digits: i, j, b1, a3)
    if (GENERATED_BINDING_RE.test(name)) continue;
    
    // Skip method calls on generated variables (b1.tail, z.head, p2.is_empty)
    if (VARIABLE_METHOD_RE.test(name)) continue;
    
    // Skip if it's a method call on a module we recognize
    const parts = name.split('.');
    if (parts.length > 1) {
      if (AIKEN_STDLIB.has(name)) continue;
      
      const modulePrefix = parts[0];
      const knownModules = ['list', 'dict', 'value', 'bytearray', 'string', 'math', 'option', 'interval', 'cbor', 'hash', 'tx', 'transaction', 'builtin'];
      if (knownModules.includes(modulePrefix)) continue;
      
      // Skip if the prefix is a generated binding name (variable.method pattern)
      if (GENERATED_BINDING_RE.test(modulePrefix)) continue;
    }
    
    calls.add(name);
  }
  
  return calls;
}

/**
 * Detect placeholder patterns in the code
 */
function detectPlaceholders(code: string): string[] {
  const placeholders: string[] = [];
  const lines = code.split('\n');
  
  const patterns = [
    /\?\?\?/,
    /\btodo\b/i,
    /\/\/\s*Similar\s+structure/i,
    /\/\/\s*TODO/i,
    /\/\/\s*FIXME/i,
    /\/\*\s*TODO/i,
    /\bpanic\s*\(/,
    /\bfail\s*$/,
    /\.\.\./,  // Ellipsis often indicates incomplete code
    /\/\/\s*\.\.\./,
    /\/\/\s*etc/i,
    /\/\/\s*and\s+so\s+on/i,
    /\/\/\s*placeholder/i,
  ];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        placeholders.push(`Line ${i + 1}: ${line.trim().slice(0, 60)}${line.trim().length > 60 ? '...' : ''}`);
        break; // Only count each line once
      }
    }
  }
  
  return placeholders;
}

/**
 * Count builtin. references in the code
 */
function countBuiltinCalls(code: string): number {
  const matches = code.match(/builtin\.[a-zA-Z_][a-zA-Z0-9_]*/g);
  return matches ? matches.length : 0;
}

/**
 * Verify decompiled Aiken code quality against UPLC ground truth
 * 
 * @param code - The Aiken code to verify (raw decompiled or AI-enhanced)
 * @param uplcConstants - Constants extracted from UPLC AST
 * @param traceStrings - Trace messages from bytecode
 * @returns Verification result with confidence score and detailed issues
 */
export function verifyCode(
  code: string,
  uplcConstants: UplcConstants,
  traceStrings: string[]
): VerificationResult {
  const issues: string[] = [];
  
  // Count total lines (non-empty)
  const lines = code.split('\n').filter(l => l.trim().length > 0);
  const totalLines = Math.max(lines.length, 1);
  
  // 1. Constant Presence Score
  const missingConstants: string[] = [];
  let foundConstants = 0;
  let totalNonTrivialConstants = 0;
  
  // Check bytestrings
  for (const bs of uplcConstants.bytestrings) {
    if (bs.length < 8) continue; // Skip trivial
    totalNonTrivialConstants++;
    if (findBytestring(code, bs)) {
      foundConstants++;
    } else {
      const ascii = hexToAscii(bs);
      missingConstants.push(ascii ? `${bs} ("${ascii}")` : bs);
    }
  }
  
  // Check integers
  for (const intStr of uplcConstants.integers) {
    const val = parseInt(intStr);
    if (val === 0 || val === 1) continue; // Skip trivial
    totalNonTrivialConstants++;
    if (findInteger(code, intStr)) {
      foundConstants++;
    } else {
      missingConstants.push(intStr);
    }
  }
  
  // Check trace strings (they should appear in the code)
  for (const trace of traceStrings) {
    if (trace.length < 3) continue;
    totalNonTrivialConstants++;
    if (code.includes(trace) || code.includes(`"${trace}"`)) {
      foundConstants++;
    } else {
      missingConstants.push(`trace: "${trace}"`);
    }
  }
  
  const constantScore = totalNonTrivialConstants > 0 
    ? foundConstants / totalNonTrivialConstants 
    : 1.0;
  
  if (missingConstants.length > 0) {
    issues.push(`Missing ${missingConstants.length} constant(s) from bytecode`);
  }
  
  // 2. Undefined References Score
  const definedFunctions = extractDefinedFunctions(code);
  const calledFunctions = extractFunctionCalls(code);
  const undefinedFunctions: string[] = [];
  
  for (const fn of calledFunctions) {
    // Check if the base function name is defined
    const baseName = fn.split('.')[0];
    if (!definedFunctions.has(fn) && !definedFunctions.has(baseName)) {
      // Double-check it's not a stdlib or constructor we might have missed
      if (!AIKEN_STDLIB.has(fn) && !TYPE_CONSTRUCTORS.has(fn) && !TYPE_CONSTRUCTORS.has(baseName)) {
        undefinedFunctions.push(fn);
      }
    }
  }
  
  const totalCalled = calledFunctions.size;
  const definedCount = totalCalled - undefinedFunctions.length;
  const referenceScore = totalCalled > 0 
    ? Math.max(0, definedCount / totalCalled)
    : 1.0;
  
  if (undefinedFunctions.length > 0) {
    issues.push(`${undefinedFunctions.length} undefined function reference(s)`);
  }
  
  // 3. Placeholder Detection Score
  const placeholders = detectPlaceholders(code);
  const placeholderRatio = placeholders.length / totalLines;
  const placeholderScore = Math.max(0, 1.0 - placeholderRatio);
  
  if (placeholders.length > 0) {
    issues.push(`${placeholders.length} placeholder/TODO pattern(s) detected`);
  }
  
  // 4. Abstraction Score (builtin density)
  const builtinCalls = countBuiltinCalls(code);
  const builtinDensity = builtinCalls / totalLines;
  // High builtin density means the AI didn't abstract well
  // Allow up to 2 builtins per line on average before penalizing
  const abstractionScore = Math.max(0, 1.0 - Math.min(1.0, builtinCalls / (totalLines * 2)));
  
  if (builtinDensity > 0.5) {
    issues.push(`High builtin density (${builtinDensity.toFixed(2)} per line) - code may need more abstraction`);
  }
  
  // Determine confidence level
  let confidence: 'high' | 'medium' | 'low';
  
  if (constantScore === 1.0 && referenceScore === 1.0 && placeholderScore === 1.0) {
    confidence = 'high';
  } else if (constantScore >= 0.6 && referenceScore >= 0.8) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }
  
  return {
    confidence,
    constantScore,
    referenceScore,
    placeholderScore,
    abstractionScore,
    missingConstants,
    undefinedFunctions,
    placeholders,
    builtinDensity,
    totalConstants: totalNonTrivialConstants,
    foundConstants,
    issues,
  };
}
