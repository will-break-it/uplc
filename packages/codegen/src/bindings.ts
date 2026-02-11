/**
 * Binding Resolution - Extract and analyze all let-bound values
 * 
 * UPLC "let x = value in body" is represented as ((lam x body) value)
 * This module extracts all such bindings and determines how to handle them:
 * 
 * 1. INLINE - Simple values that should be substituted (constants, identity, simple builtins)
 * 2. RENAME - Complex values that need semantic names (predicates, validators)
 * 3. KEEP - Recursive or complex functions that stay as-is
 */

import type { UplcTerm, UplcValue } from '@uplc/parser';

/**
 * Arity (number of required arguments) for common builtins
 */
const BUILTIN_ARITY: Record<string, number> = {
  // Binary ops
  addInteger: 2, subtractInteger: 2, multiplyInteger: 2, divideInteger: 2,
  modInteger: 2, quotientInteger: 2, remainderInteger: 2,
  equalsInteger: 2, lessThanInteger: 2, lessThanEqualsInteger: 2,
  appendByteString: 2, equalsByteString: 2, lessThanByteString: 2,
  lessThanEqualsByteString: 2,
  appendString: 2, equalsString: 2,
  constrData: 2, mkPairData: 2,
  ifThenElse: 3, chooseList: 3, chooseData: 6,
  // Unary ops
  unIData: 1, unBData: 1, unListData: 1, unMapData: 1, unConstrData: 1,
  iData: 1, bData: 1, listData: 1, mapData: 1,
  headList: 1, tailList: 1, nullList: 1,
  fstPair: 1, sndPair: 1,
  sha2_256: 1, sha3_256: 1, blake2b_256: 1, blake2b_224: 1, keccak_256: 1,
  lengthOfByteString: 1, encodeUtf8: 1, decodeUtf8: 1,
  serialiseData: 1,
  // Two args
  mkCons: 2, sliceByteString: 3, indexByteString: 2, consByteString: 2,
  trace: 2, verifyEd25519Signature: 3,
};

/**
 * A resolved binding with its analysis
 */
export interface ResolvedBinding {
  name: string;
  value: UplcTerm;
  category: 'inline' | 'rename' | 'keep';
  semanticName?: string;
  inlineValue?: string;  // For constants or simple expressions
  pattern?: BindingPattern;
}

export type BindingPattern = 
  | 'constant_true'
  | 'constant_false'
  | 'constant_int'
  | 'constant_bytes'
  | 'constant_unit'
  | 'identity'
  | 'apply'
  | 'compose'
  | 'is_constr_n'      // fn(x) { fst(unconstr(x)) == N }
  | 'expect_constr_n'  // fn(x) { if fst(unconstr(x)) == N then snd(unconstr(x)) else fail }
  | 'field_accessor'   // fn(x) { head(tail^n(snd(unconstr(x)))) }
  | 'builtin_wrapper'  // fn(x) { builtin(x) }
  | 'partial_builtin'  // builtin with some args applied
  | 'boolean_and'      // fn(a, b) { if a then b else False }
  | 'boolean_or'       // fn(a, b) { if a then True else b }
  | 'list_fold'        // Y combinator fold pattern
  | 'unknown';

/**
 * Binding environment built from AST traversal
 */
export class BindingEnvironment {
  private bindings = new Map<string, ResolvedBinding>();
  
  /**
   * Build binding environment from a term
   */
  static build(term: UplcTerm): BindingEnvironment {
    const env = new BindingEnvironment();
    env.extract(term);
    return env;
  }
  
  /**
   * Get a binding by name
   */
  get(name: string): ResolvedBinding | undefined {
    return this.bindings.get(name);
  }
  
  /**
   * Check if a name should be inlined
   */
  shouldInline(name: string): boolean {
    const binding = this.bindings.get(name);
    return binding?.category === 'inline';
  }
  
  /**
   * Get the inline value for a binding
   */
  getInlineValue(name: string): string | undefined {
    const binding = this.bindings.get(name);
    return binding?.inlineValue;
  }
  
  /**
   * Get the semantic name for a binding
   */
  getSemanticName(name: string): string | undefined {
    const binding = this.bindings.get(name);
    return binding?.semanticName;
  }
  
  /**
   * Get all bindings for debugging
   */
  all(): ResolvedBinding[] {
    return Array.from(this.bindings.values());
  }
  
  /**
   * Extract bindings from a term (mutates this.bindings)
   */
  private extract(term: UplcTerm): void {
    this.walk(term, new Set());
  }
  
  /**
   * Walk AST to find let bindings
   */
  private walk(term: UplcTerm, seen: Set<UplcTerm>): void {
    if (seen.has(term)) return;
    seen.add(term);
    
    switch (term.tag) {
      case 'app': {
        // Check for let pattern: ((lam x body) value)
        // Also unwrap force/delay: (force(lam x body)) (delay(value))
        let func = term.func;
        let arg = term.arg;
        while (func && (func.tag === 'force' || func.tag === 'delay')) func = func.term;
        while (arg && (arg.tag === 'force' || arg.tag === 'delay')) arg = arg.term;
        
        if (func?.tag === 'lam') {
          const name = func.param;
          const value = arg;
          
          // Analyze and store the binding
          const resolved = this.analyzeBinding(name, value);
          this.bindings.set(name, resolved);
          
          // Continue walking both parts
          this.walk(func.body, seen);
          this.walk(value, seen);
        } else {
          this.walk(term.func, seen);
          this.walk(term.arg, seen);
        }
      }
        break;
        
      case 'lam':
        this.walk(term.body, seen);
        break;
        
      case 'force':
      case 'delay':
        this.walk(term.term, seen);
        break;
        
      case 'case':
        if (term.scrutinee) this.walk(term.scrutinee, seen);
        if (term.branches) {
          for (const branch of term.branches) {
            this.walk(branch, seen);
          }
        }
        break;
    }
  }
  
  /**
   * Analyze a binding and determine its category and semantics
   */
  private analyzeBinding(name: string, value: UplcTerm): ResolvedBinding {
    // Unwrap all force/delay layers to get the real value
    let unwrapped = value;
    while (unwrapped && (unwrapped.tag === 'force' || unwrapped.tag === 'delay')) {
      unwrapped = unwrapped.term;
    }
    
    // Check for constants first
    if (unwrapped.tag === 'con') {
      return this.analyzeConstant(name, unwrapped);
    }
    
    // Check for builtin reference
    if (unwrapped.tag === 'builtin') {
      return {
        name,
        value,
        category: 'rename',
        semanticName: unwrapped.name,
        pattern: 'builtin_wrapper'
      };
    }
    
    // Check for lambda patterns
    if (unwrapped.tag === 'lam') {
      return this.analyzeLambda(name, unwrapped);
    }
    
    // Check for partial application patterns
    if (unwrapped.tag === 'app') {
      return this.analyzeApplication(name, unwrapped);
    }
    
    // Default: keep as-is
    return {
      name,
      value,
      category: 'keep',
      pattern: 'unknown'
    };
  }
  
  /**
   * Analyze a constant binding
   */
  private analyzeConstant(name: string, term: UplcTerm): ResolvedBinding {
    if (term.tag !== 'con') {
      return { name, value: term, category: 'keep', pattern: 'unknown' };
    }
    
    const val = term.value;
    if (!val) {
      return { name, value: term, category: 'inline', inlineValue: '()', pattern: 'constant_unit' };
    }
    
    switch (val.tag) {
      case 'bool':
        return {
          name,
          value: term,
          category: 'inline',
          inlineValue: val.value ? 'True' : 'False',
          pattern: val.value ? 'constant_true' : 'constant_false'
        };
        
      case 'integer':
        return {
          name,
          value: term,
          category: 'inline',
          inlineValue: val.value.toString(),
          pattern: 'constant_int'
        };
        
      case 'unit':
        return {
          name,
          value: term,
          category: 'inline',
          inlineValue: '()',
          pattern: 'constant_unit'
        };
        
      case 'bytestring':
        const hex = bytesToHex(val.value);
        return {
          name,
          value: term,
          category: 'inline',
          inlineValue: `#"${hex}"`,
          pattern: 'constant_bytes'
        };
      
      case 'string':
        return {
          name,
          value: term,
          category: 'inline',
          inlineValue: `"${val.value}"`,
          pattern: 'constant_string' as any
        };
      
      case 'data':
        return {
          name,
          value: term,
          category: 'inline',
          inlineValue: dataConstToString(val.value),
          pattern: 'constant_data' as any
        };
      
      case 'list':
        const listItems = (val as any).items || (val as any).value || (val as any).list || [];
        if (Array.isArray(listItems) && listItems.length === 0) {
          return { name, value: term, category: 'inline', inlineValue: '[]', pattern: 'constant_list' as any };
        }
        return {
          name,
          value: term,
          category: 'inline',
          inlineValue: listConstToString(listItems),
          pattern: 'constant_list' as any
        };
      
      case 'pair':
        return {
          name,
          value: term,
          category: 'inline',
          inlineValue: `(${dataConstToString(val.fst)}, ${dataConstToString(val.snd)})`,
          pattern: 'constant_pair' as any
        };
        
      default:
        return { name, value: term, category: 'keep', pattern: 'unknown' };
    }
  }
  
  /**
   * Analyze a lambda binding
   */
  private analyzeLambda(name: string, term: UplcTerm): ResolvedBinding {
    if (term.tag !== 'lam') {
      return { name, value: term, category: 'keep', pattern: 'unknown' };
    }
    
    const param = term.param;
    const body = term.body;
    
    // Identity: fn(x) { x }
    if (body.tag === 'var' && body.name === param) {
      return {
        name,
        value: term,
        category: 'inline',
        semanticName: 'id',
        pattern: 'identity'
      };
    }
    
    // Builtin wrapper: fn(x) { builtin(x) }
    if (body.tag === 'app') {
      const parts = flattenApp(body);
      const builtin = getBuiltinName(parts[0]);
      if (builtin && parts.length === 2 && 
          parts[1].tag === 'var' && parts[1].name === param) {
        return {
          name,
          value: term,
          category: 'rename',
          semanticName: builtinToSemanticName(builtin),
          pattern: 'builtin_wrapper'
        };
      }
    }
    
    // Check for is_constr_N pattern: fn(x) { equalsInteger(fstPair(unConstrData(x)), N) }
    const constrCheck = this.detectConstrCheck(term);
    if (constrCheck !== null) {
      return {
        name,
        value: term,
        category: 'rename',
        semanticName: `is_constr_${constrCheck}`,
        pattern: 'is_constr_n'
      };
    }
    
    // Check for field accessor: fn(x) { head(tail^n(snd(unconstr(x)))) }
    const fieldIndex = this.detectFieldAccessor(term);
    if (fieldIndex !== null) {
      return {
        name,
        value: term,
        category: 'rename',
        semanticName: `get_field_${fieldIndex}`,
        pattern: 'field_accessor'
      };
    }
    
    // Check for two-param patterns
    if (body.tag === 'lam') {
      const pattern = this.detectTwoParamPattern(param, body.param, body.body);
      if (pattern) {
        return {
          name,
          value: term,
          category: pattern.category,
          semanticName: pattern.semanticName,
          pattern: pattern.pattern as BindingPattern
        };
      }
    }
    
    // Unknown lambda - keep but try to give a name based on usage
    return {
      name,
      value: term,
      category: 'keep',
      pattern: 'unknown'
    };
  }
  
  /**
   * Analyze an application binding (partial application or immediate call)
   */
  private analyzeApplication(name: string, term: UplcTerm): ResolvedBinding {
    const parts = flattenApp(term);
    const head = parts[0];
    
    // Check for builtin application
    const builtin = getBuiltinName(head);
    if (builtin) {
      const argCount = parts.length - 1;
      const requiredArity = BUILTIN_ARITY[builtin] || 1;
      
      // Only partial if we have fewer args than required
      if (argCount < requiredArity) {
        const semanticName = this.getPartialBuiltinName(builtin, parts.slice(1));
        return {
          name,
          value: term,
          category: 'rename',
          semanticName,
          pattern: 'partial_builtin'
        };
      }
      
      // Fully applied - keep as expression
      return { name, value: term, category: 'keep', pattern: 'unknown' };
    }
    
    // Y combinator application (recursion)
    // Pattern: Y(fn(self) { ... })
    if (head.tag === 'var') {
      const headBinding = this.bindings.get(head.name);
      if (headBinding?.pattern === 'unknown' && parts.length === 2 && parts[1].tag === 'lam') {
        // This might be Y combinator - check if the lambda references itself
        // For now, just mark as list_fold if it looks recursive
        return {
          name,
          value: term,
          category: 'rename',
          semanticName: `recursive_${name}`,
          pattern: 'list_fold'
        };
      }
    }
    
    return { name, value: term, category: 'keep', pattern: 'unknown' };
  }
  
  /**
   * Get a semantic name for a partial builtin application
   */
  private getPartialBuiltinName(builtin: string, args: UplcTerm[]): string {
    // Special patterns for comparisons with constants
    if (args.length === 1) {
      const constVal = extractIntConstant(args[0]);
      if (constVal !== null) {
        switch (builtin) {
          case 'equalsInteger':
            return `eq_${constVal}`;  // eq_0, eq_1, eq_2
          case 'lessThanInteger':
            return `lt_${constVal}`;
          case 'lessThanEqualsInteger':
            return `lte_${constVal}`;
          case 'addInteger':
            return constVal >= 0 ? `add_${constVal}` : `sub_${-constVal}`;
          case 'subtractInteger':
            return `sub_${constVal}`;
          case 'multiplyInteger':
            return `mul_${constVal}`;
          case 'divideInteger':
            return `div_${constVal}`;
        }
      }
      
      // Check for bytestring constants
      if (args[0].tag === 'con' && args[0].value?.tag === 'bytestring') {
        switch (builtin) {
          case 'equalsByteString':
            return 'eq_bytes';
          case 'appendByteString':
            return 'append_bytes';
        }
      }
    }
    
    // Fallback to generic name
    return builtinToSemanticName(builtin);
  }
  
  /**
   * Detect is_constr_N pattern: fn(x) { equalsInteger(fstPair(unConstrData(x)), N) }
   */
  private detectConstrCheck(term: UplcTerm): number | null {
    if (term.tag !== 'lam') return null;
    
    const param = term.param;
    const body = term.body;
    
    const parts = flattenApp(body);
    if (getBuiltinName(parts[0]) !== 'equalsInteger' || parts.length !== 3) {
      return null;
    }
    
    // One arg should be fstPair(unConstrData(x)), other should be constant
    for (let i = 1; i < 3; i++) {
      const constVal = extractIntConstant(parts[i]);
      if (constVal !== null) {
        // Verify the other arg is fstPair(unConstrData(param))
        const other = parts[i === 1 ? 2 : 1];
        if (this.isFstUnconstr(other, param)) {
          return Number(constVal);
        }
      }
    }
    
    return null;
  }
  
  /**
   * Check if term matches fstPair(unConstrData(varName))
   */
  private isFstUnconstr(term: UplcTerm, varName: string): boolean {
    const parts = flattenApp(term);
    if (getBuiltinName(parts[0]) !== 'fstPair' || parts.length !== 2) return false;
    
    const inner = flattenApp(parts[1]);
    if (getBuiltinName(inner[0]) !== 'unConstrData' || inner.length !== 2) return false;
    
    return inner[1].tag === 'var' && inner[1].name === varName;
  }
  
  /**
   * Detect field accessor: fn(x) { head(tail^n(snd(unconstr(x)))) }
   */
  private detectFieldAccessor(term: UplcTerm): number | null {
    if (term.tag !== 'lam') return null;
    
    const param = term.param;
    let current = term.body;
    
    // Expect headList at the top
    let parts = flattenApp(current);
    if (getBuiltinName(parts[0]) !== 'headList' || parts.length !== 2) return null;
    current = parts[1];
    
    // Count tailList applications
    let tailCount = 0;
    while (true) {
      parts = flattenApp(current);
      const builtin = getBuiltinName(parts[0]);
      
      if (builtin === 'tailList' && parts.length === 2) {
        tailCount++;
        current = parts[1];
      } else if (builtin === 'sndPair' && parts.length === 2) {
        // Check for unConstrData(param)
        const inner = flattenApp(parts[1]);
        if (getBuiltinName(inner[0]) === 'unConstrData' && inner.length === 2) {
          if (inner[1].tag === 'var' && inner[1].name === param) {
            return tailCount;
          }
        }
        return null;
      } else {
        return null;
      }
    }
  }
  
  /**
   * Detect two-parameter patterns (apply, compose, boolean and/or)
   */
  private detectTwoParamPattern(
    param1: string, 
    param2: string, 
    body: UplcTerm
  ): { category: 'inline' | 'rename'; semanticName: string; pattern: string } | null {
    // Apply: fn(f, x) { f(x) }
    if (body.tag === 'app' && 
        body.func.tag === 'var' && body.func.name === param1 &&
        body.arg.tag === 'var' && body.arg.name === param2) {
      return { category: 'inline', semanticName: 'apply', pattern: 'apply' };
    }
    
    // Boolean AND: fn(a, b) { if a then b else False }
    const ifParts = flattenApp(body);
    if (getBuiltinName(ifParts[0]) === 'ifThenElse' && ifParts.length === 4) {
      const cond = ifParts[1];
      const thenBr = unwrapDelays(ifParts[2]);
      const elseBr = unwrapDelays(ifParts[3]);
      
      // AND pattern: if a then b else False
      if (cond.tag === 'var' && cond.name === param1 &&
          thenBr.tag === 'var' && thenBr.name === param2 &&
          isConstFalse(elseBr)) {
        return { category: 'rename', semanticName: 'and', pattern: 'boolean_and' };
      }
      
      // OR pattern: if a then True else b  
      if (cond.tag === 'var' && cond.name === param1 &&
          isConstTrue(thenBr) &&
          elseBr.tag === 'var' && elseBr.name === param2) {
        return { category: 'rename', semanticName: 'or', pattern: 'boolean_or' };
      }
    }
    
    return null;
  }
}

// ============ Utility Functions ============

function unwrapForces(term: UplcTerm): UplcTerm {
  while (term.tag === 'force') {
    term = term.term;
  }
  return term;
}

function unwrapDelays(term: UplcTerm): UplcTerm {
  while (term.tag === 'delay') {
    term = term.term;
  }
  return term;
}

function flattenApp(term: UplcTerm): UplcTerm[] {
  const parts: UplcTerm[] = [];
  let current = term;
  
  while (current.tag === 'app') {
    parts.unshift(current.arg);
    current = current.func;
  }
  
  current = unwrapForces(current);
  parts.unshift(current);
  
  return parts;
}

function getBuiltinName(term: UplcTerm): string | null {
  term = unwrapForces(term);
  return term.tag === 'builtin' ? term.name : null;
}

function extractIntConstant(term: UplcTerm): bigint | null {
  if (term.tag === 'con' && term.value?.tag === 'integer') {
    return term.value.value;
  }
  return null;
}

/** Convert a PlutusData value to a readable string */
function dataConstToString(data: any): string {
  if (!data) return '<data>';
  if (data instanceof Uint8Array) return `#"${bytesToHex(data)}"`;
  if (typeof data === 'bigint' || typeof data === 'number') return data.toString();
  
  switch (data.tag) {
    case 'bytes': {
      const val = data.value;
      if (val instanceof Uint8Array) return `#"${bytesToHex(val)}"`;
      if (typeof val === 'string') return `#"${val}"`;
      return `#""`;
    }
    case 'int':
      return (data.value ?? 0).toString();
    case 'list': {
      const items = data.value || data.list || [];
      if (!Array.isArray(items) || items.length === 0) return '[]';
      return `[${items.map(dataConstToString).join(', ')}]`;
    }
    case 'constr': {
      const fields = data.fields || [];
      const fieldStrs = Array.isArray(fields) ? fields.map(dataConstToString) : [];
      return `Constr(${data.index ?? 0}${fieldStrs.length ? ', ' + fieldStrs.join(', ') : ''})`;
    }
    case 'map': {
      const entries = data.value || [];
      if (!Array.isArray(entries) || entries.length === 0) return '{}';
      const strs = entries.map(([k, v]: [any, any]) =>
        `${dataConstToString(k)}: ${dataConstToString(v)}`
      );
      return `{ ${strs.join(', ')} }`;
    }
    default:
      if (typeof data === 'string') return `#"${data}"`;
      return '<data>';
  }
}

/** Convert a list constant to a readable string */
function listConstToString(items: any[]): string {
  if (!Array.isArray(items) || items.length === 0) return '[]';
  const strs = items.map((item: any) => {
    if (!item) return '<null>';
    // Items might be wrapped in {tag: 'data', value: ...}
    if (item.tag === 'data' && item.value) return dataConstToString(item.value);
    return dataConstToString(item);
  });
  return `[${strs.join(', ')}]`;
}

function bytesToHex(bytes: Uint8Array | number[]): string {
  const arr = bytes instanceof Uint8Array ? bytes : (Array.isArray(bytes) ? bytes : Object.values(bytes));
  return Array.from(arr as number[])
    .map((b: number) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isConstTrue(term: UplcTerm): boolean {
  return term.tag === 'con' && term.value?.tag === 'bool' && term.value.value === true;
}

function isConstFalse(term: UplcTerm): boolean {
  return term.tag === 'con' && term.value?.tag === 'bool' && term.value.value === false;
}

function builtinToSemanticName(builtin: string): string {
  const map: Record<string, string> = {
    'unIData': 'to_int',
    'unBData': 'to_bytes',
    'unListData': 'to_list',
    'unMapData': 'to_map',
    'unConstrData': 'to_constr',
    'iData': 'from_int',
    'bData': 'from_bytes',
    'listData': 'from_list',
    'fstPair': '1st',
    'sndPair': '2nd',
    'headList': 'head',
    'tailList': 'tail',
    'nullList': 'is_empty',
  };
  return map[builtin] || builtin;
}
