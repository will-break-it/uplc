/**
 * Type Cast System for Aiken Code Generation
 * 
 * Inserts `expect` casts when Data values flow into typed builtin positions.
 * This addresses the core issue where decompiled UPLC (untyped) doesn't satisfy
 * Aiken's type checker requirements for builtin functions.
 */

export type AikenType = 
  | 'Data' 
  | 'Int'
  | 'ByteArray'
  | 'Bool'
  | 'String'
  | 'List<Data>'
  | 'List<Int>'
  | 'List<ByteArray>'
  | 'Pair<Int, List<Data>>'
  | 'Pair<Data, Data>'
  | 'List<Pair<Data, Data>>'
  | 'Void'
  | 'unknown';

export interface BuiltinTypeSignature {
  /** Input parameter types (in order) */
  inputs: AikenType[];
  /** Return type */
  output: AikenType;
  /** Human readable description for debugging */
  description?: string;
}

/**
 * Builtin type signatures for common UPLC operations used in decompiled code.
 * This maps each builtin to its expected input types and output type.
 * Keys match the actual builtin names used in the generator.
 */
export const BUILTIN_TYPE_SIGNATURES: Record<string, BuiltinTypeSignature> = {
  // List operations - require List<T> input
  headList: {
    inputs: ['List<Data>'],
    output: 'Data',
    description: 'Get first element of list'
  },
  tailList: {
    inputs: ['List<Data>'],
    output: 'List<Data>',
    description: 'Get list without first element'
  },
  nullList: {
    inputs: ['List<Data>'],
    output: 'Bool',
    description: 'Check if list is empty'
  },
  mkCons: {
    inputs: ['Data', 'List<Data>'],
    output: 'List<Data>',
    description: 'Prepend element to list'
  },

  // Pair operations - require Pair<T,U> input
  fstPair: {
    inputs: ['Pair<Int, List<Data>>'],
    output: 'Int',
    description: 'Get first element of pair'
  },
  sndPair: {
    inputs: ['Pair<Int, List<Data>>'],
    output: 'List<Data>',
    description: 'Get second element of pair'
  },
  mkPairData: {
    inputs: ['Data', 'Data'],
    output: 'Pair<Data, Data>',
    description: 'Create data pair'
  },

  // Data destructuring - input is Data, output is typed
  unConstrData: {
    inputs: ['Data'],
    output: 'Pair<Int, List<Data>>',
    description: 'Extract constructor tag and fields'
  },
  unIData: {
    inputs: ['Data'],
    output: 'Int',
    description: 'Extract integer from Data'
  },
  unBData: {
    inputs: ['Data'],
    output: 'ByteArray',
    description: 'Extract bytearray from Data'
  },
  unListData: {
    inputs: ['Data'],
    output: 'List<Data>',
    description: 'Extract list from Data'
  },
  unMapData: {
    inputs: ['Data'],
    output: 'List<Pair<Data, Data>>',
    description: 'Extract map from Data'
  },

  // Data construction - inputs are typed, output is Data
  constrData: {
    inputs: ['Int', 'List<Data>'],
    output: 'Data',
    description: 'Create constructor Data'
  },
  iData: {
    inputs: ['Int'],
    output: 'Data',
    description: 'Wrap integer as Data'
  },
  bData: {
    inputs: ['ByteArray'],
    output: 'Data',
    description: 'Wrap bytearray as Data'
  },
  listData: {
    inputs: ['List<Data>'],
    output: 'Data',
    description: 'Wrap list as Data'
  },
  mapData: {
    inputs: ['List<Pair<Data, Data>>'],
    output: 'Data',
    description: 'Wrap map as Data'
  },

  // Integer operations - require Int inputs
  equalsInteger: {
    inputs: ['Int', 'Int'],
    output: 'Bool',
    description: 'Integer equality'
  },
  lessThanInteger: {
    inputs: ['Int', 'Int'],
    output: 'Bool',
    description: 'Integer less than'
  },
  lessThanEqualsInteger: {
    inputs: ['Int', 'Int'],
    output: 'Bool',
    description: 'Integer less than or equal'
  },
  addInteger: {
    inputs: ['Int', 'Int'],
    output: 'Int',
    description: 'Integer addition'
  },
  subtractInteger: {
    inputs: ['Int', 'Int'],
    output: 'Int',
    description: 'Integer subtraction'
  },
  multiplyInteger: {
    inputs: ['Int', 'Int'],
    output: 'Int',
    description: 'Integer multiplication'
  },
  divideInteger: {
    inputs: ['Int', 'Int'],
    output: 'Int',
    description: 'Integer division'
  },
  modInteger: {
    inputs: ['Int', 'Int'],
    output: 'Int',
    description: 'Integer modulo'
  },

  // ByteArray operations - require ByteArray inputs
  equalsByteString: {
    inputs: ['ByteArray', 'ByteArray'],
    output: 'Bool',
    description: 'ByteArray equality'
  },
  lessThanByteString: {
    inputs: ['ByteArray', 'ByteArray'],
    output: 'Bool',
    description: 'ByteArray less than'
  },
  lessThanEqualsByteString: {
    inputs: ['ByteArray', 'ByteArray'],
    output: 'Bool',
    description: 'ByteArray less than or equal'
  },
  appendByteString: {
    inputs: ['ByteArray', 'ByteArray'],
    output: 'ByteArray',
    description: 'ByteArray concatenation'
  },
  lengthOfByteString: {
    inputs: ['ByteArray'],
    output: 'Int',
    description: 'ByteArray length'
  },
  sliceByteString: {
    inputs: ['Int', 'Int', 'ByteArray'],
    output: 'ByteArray',
    description: 'ByteArray slice'
  },

  // Control flow
  ifThenElse: {
    inputs: ['Bool', 'Data', 'Data'],
    output: 'Data',
    description: 'Conditional expression'
  },

  // Generic operations that work on any type
  equalsData: {
    inputs: ['Data', 'Data'],
    output: 'Bool',
    description: 'Data equality'
  },
  trace: {
    inputs: ['String', 'Data'],
    output: 'Data',
    description: 'Debug trace'
  },
};

/**
 * Tracks the known type of expressions during code generation.
 * This allows us to determine when casts are needed.
 */
export class TypeContext {
  private typeMap: Map<string, AikenType> = new Map();

  /** Record the type of a variable or expression */
  setType(name: string, type: AikenType): void {
    this.typeMap.set(name, type);
  }

  /** Get the known type of a variable, defaulting to 'Data' if unknown */
  getType(name: string): AikenType {
    return this.typeMap.get(name) || 'Data';
  }

  /** Check if a variable has a known non-Data type */
  hasKnownType(name: string): boolean {
    const type = this.typeMap.get(name);
    return type !== undefined && type !== 'Data' && type !== 'unknown';
  }

  /** Create a copy for nested scopes */
  clone(): TypeContext {
    const clone = new TypeContext();
    clone.typeMap = new Map(this.typeMap);
    return clone;
  }

  /** Add parameters to the type context */
  addParams(params: string[], types?: AikenType[]): void {
    params.forEach((param, i) => {
      const type = types?.[i] || 'Data';
      this.setType(param, type);
    });
  }

  /** Clear all type information (for isolated scopes) */
  clear(): void {
    this.typeMap.clear();
  }
}

/**
 * Generate an expect cast when needed.
 * Returns the original expression if no cast is required.
 */
export function insertExpectCast(
  expression: string, 
  currentType: AikenType, 
  expectedType: AikenType,
  varName?: string
): string {
  // No cast needed if types match or if current type is already specific enough
  if (currentType === expectedType) {
    return expression;
  }

  // No cast needed if we're going from specific to Data (upcasting)
  if (expectedType === 'Data') {
    return expression;
  }

  // No cast needed if current type is unknown (let type inference handle it)
  if (currentType === 'unknown') {
    return expression;
  }

  // Cast needed: Data -> specific type
  if ((currentType as any) === 'Data' && (expectedType as any) !== 'Data') {
    const castVar = varName || '_cast';
    return `{
  expect ${castVar}: ${expectedType} = ${expression}
  ${castVar}
}`;
  }

  // For other mismatches, just return the expression and let Aiken's type checker handle it
  return expression;
}

/**
 * Generate expect casts for builtin call arguments.
 * Returns modified argument expressions with necessary casts.
 */
export function insertBuiltinCasts(
  builtinName: string,
  argExpressions: string[],
  argTypes: AikenType[]
): string[] {
  const signature = BUILTIN_TYPE_SIGNATURES[builtinName];
  if (!signature) {
    // console.log(`No signature found for builtin: ${builtinName}`);
    return argExpressions; // Unknown builtin, no casts
  }

  const result = argExpressions.map((expr, i) => {
    const currentType = argTypes[i] || 'Data';
    const expectedType = signature.inputs[i] || 'Data';
    
    if (currentType === 'Data' && expectedType !== 'Data') {
      return insertExpectCast(expr, currentType, expectedType, `_${builtinName}_arg${i}`);
    }
    
    return expr;
  });

  return result;
}

/**
 * Determine the return type of a builtin call.
 */
export function getBuiltinReturnType(builtinName: string): AikenType {
  const signature = BUILTIN_TYPE_SIGNATURES[builtinName];
  return signature?.output || 'Data';
}

/**
 * Check if an expression represents a builtin call that produces typed output
 */
export function getExpressionType(expression: string): AikenType {
  // Check for builtin calls
  const builtinMatch = expression.match(/builtin\.([a-z_]+)\s*\(/);
  if (builtinMatch) {
    const aikenBuiltinName = builtinMatch[1];
    // Map from Aiken builtin names back to our internal names
    const builtinMap: Record<string, string> = {
      'un_constr_data': 'unConstrData',
      'un_i_data': 'unIData',
      'un_b_data': 'unBData',
      'un_list_data': 'unListData',
      'un_map_data': 'unMapData',
      'head_list': 'headList',
      'tail_list': 'tailList',
      'null_list': 'nullList',
      'fst_pair': 'fstPair',
      'snd_pair': 'sndPair',
      'constr_data': 'constrData',
      'i_data': 'iData',
      'b_data': 'bData',
      'list_data': 'listData',
      'map_data': 'mapData',
      'equals_bytearray': 'equalsByteString',
      'less_than_bytearray': 'lessThanByteString',
      'less_than_equals_bytearray': 'lessThanEqualsByteString',
    };
    const mappedName = builtinMap[aikenBuiltinName] || aikenBuiltinName;
    return getBuiltinReturnType(mappedName);
  }

  // Check for literal types
  if (/^-?\d+$/.test(expression)) return 'Int';
  if (/^#"[0-9a-fA-F]*"$/.test(expression)) return 'ByteArray';
  if (/^".*"$/.test(expression)) return 'String';
  if (expression === 'True' || expression === 'False') return 'Bool';
  if (expression === 'Void' || expression === '[]') return 'Data';

  // Check for common patterns
  if (expression.startsWith('[') && expression.endsWith(']')) {
    return 'List<Data>';
  }
  
  if (expression.startsWith('Pair(') && expression.endsWith(')')) {
    return 'Pair<Data, Data>';
  }

  // For complex expressions, default to Data
  return 'Data';
}