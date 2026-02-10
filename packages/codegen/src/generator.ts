/**
 * Code Generator - ContractStructure → GeneratedCode
 */

import type { ContractStructure, RedeemerVariant, ValidationCheck, ScriptPurpose } from '@uplc/patterns';
import type { 
  GeneratorOptions, 
  GeneratedCode, 
  ValidatorBlock, 
  HandlerBlock, 
  CodeBlock,
  TypeDefinition,
  ParameterInfo 
} from './types.js';
import { BUILTIN_MAP, getRequiredImports } from './stdlib.js';
import { extractHelpers, detectTxFieldAccess, TX_FIELD_MAP, type ExtractedHelper } from './helpers.js';
import { BindingEnvironment } from './bindings.js';
import { extractFragments, type CodeFragment } from './fragments.js';
import { detectTxField, detectDataField, detectBooleanChain, detectConstrMatch } from './patterns.js';

// Track builtins used during code generation (reset per generateValidator call)
let usedBuiltins: Set<string> = new Set();

// Track extracted helpers during code generation
let extractedHelpers: Map<string, ExtractedHelper> = new Map();

// Track which parameters are the transaction context
let txContextParam: string | null = null;

// Binding environment for resolving let-bound variables
let bindingEnv: BindingEnvironment | null = null;

// Track bindings currently being inlined to prevent infinite recursion
let inliningStack: Set<string> = new Set();

const DEFAULT_OPTIONS: GeneratorOptions = {
  comments: true,
  namingStyle: 'generic',
  includeTypes: true,
  indent: '  '
};

/**
 * Generate validator name based on script purpose
 */
function getValidatorName(purpose: ScriptPurpose): string {
  switch (purpose) {
    case 'spend': return 'script';
    case 'mint': return 'policy';
    case 'withdraw': return 'staking';
    case 'publish': return 'certificate';
    case 'vote': return 'governance';
    case 'propose': return 'proposal';
    default: return 'validator';
  }
}

/**
 * Map script purpose to handler kind
 */
function purposeToHandlerKind(purpose: ScriptPurpose): HandlerBlock['kind'] {
  switch (purpose) {
    case 'spend': return 'spend';
    case 'mint': return 'mint';
    case 'withdraw': return 'withdraw';
    case 'publish': return 'publish';
    case 'vote': return 'vote';
    case 'propose': return 'propose';
    default: return 'spend';  // Default fallback
  }
}

/**
 * Generate code structure from contract analysis
 */
export function generateValidator(
  structure: ContractStructure, 
  options?: Partial<GeneratorOptions>
): GeneratedCode {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  // Reset tracking state
  usedBuiltins = new Set();
  extractedHelpers = new Map();
  bindingEnv = null;
  inliningStack = new Set();
  
  // Build binding environment from full AST (includes all let-bindings)
  // Extract helpers from raw body (the validator body after stripping params)
  if (structure.fullAst) {
    bindingEnv = BindingEnvironment.build(structure.fullAst);
  }
  if (structure.rawBody) {
    extractedHelpers = extractHelpers(structure.rawBody);
  }
  
  // Determine transaction context parameter
  txContextParam = structure.params[structure.params.length - 1] || null;
  
  const types: TypeDefinition[] = [];
  
  // Generate datum type if used with fields
  if (structure.datum?.isUsed && structure.datum.fields.length > 0) {
    types.push(generateDatumType(structure.datum.fields));
  }
  
  // Generate redeemer type if we have variants
  if (structure.redeemer?.variants?.length > 0) {
    types.push(generateRedeemerType(structure.redeemer.variants, opts));
  }
  
  // Determine handler kind based on script purpose
  const handlerKind = purposeToHandlerKind(structure.type);
  
  // Generate handler body (this populates usedBuiltins)
  const body = generateHandlerBody(structure, opts);
  
  // Build handler
  const handler: HandlerBlock = {
    kind: handlerKind,
    params: generateParams(structure, opts),
    body
  };
  
  // Build validator with purpose-based name
  const validatorName = getValidatorName(structure.type);
  const validator: ValidatorBlock = {
    name: validatorName,
    params: [], // No validator-level params detected yet
    handlers: [handler]
  };
  
  // Collect required imports from used builtins
  const imports = getRequiredImports(Array.from(usedBuiltins));
  
  // Convert script parameters to output format
  const scriptParams = structure.scriptParams?.map(p => ({
    name: p.name,
    type: p.type as 'bytestring' | 'integer' | 'data',
    value: p.value
  }));
  
  return { validator, types, imports, scriptParams };
}

// Common variant names for redeemer types
const VARIANT_NAMES = ['Cancel', 'Update', 'Claim', 'Execute', 'Withdraw', 'Deposit'];

/**
 * Get variant name for a given index
 */
function getVariantName(index: number): string {
  return index < VARIANT_NAMES.length ? VARIANT_NAMES[index] : `Variant${index}`;
}

/**
 * Generate redeemer type definition
 */
function generateRedeemerType(variants: RedeemerVariant[], opts: GeneratorOptions): TypeDefinition {
  return {
    name: 'Action',
    kind: 'enum',
    variants: variants.map((v, i) => ({
      name: getVariantName(i),
      fields: v.fields.map((f, j) => ({
        name: inferFieldName(j, f.inferredType),
        type: mapToAikenType(f.inferredType)
      }))
    }))
  };
}

/**
 * Generate datum type definition from field info
 */
function generateDatumType(fields: import('@uplc/patterns').FieldInfo[]): TypeDefinition {
  // Common datum field names based on position
  const fieldNameHints = ['owner', 'beneficiary', 'deadline', 'amount', 'token', 'data'];
  
  return {
    name: 'Datum',
    kind: 'struct',
    fields: fields.map((f, i) => ({
      name: i < fieldNameHints.length ? fieldNameHints[i] : `field_${i}`,
      type: mapToAikenType(f.inferredType)
    }))
  };
}

/**
 * Infer a field name based on index and type
 */
function inferFieldName(index: number, inferredType: string): string {
  const hints: Record<string, string[]> = {
    'ByteArray': ['owner', 'beneficiary', 'token_name', 'signature'],
    'Int': ['amount', 'deadline', 'index', 'count'],
    'unknown': ['value', 'data', 'param', 'arg']
  };
  
  const typeHints = hints[inferredType] || hints['unknown'];
  return index < typeHints.length ? typeHints[index] : `field_${index}`;
}

/**
 * Map inferred types to Aiken types
 */
function mapToAikenType(inferredType: string): string {
  switch (inferredType) {
    case 'integer': return 'Int';
    case 'bytestring': return 'ByteArray';
    case 'string': return 'String';
    case 'bool': return 'Bool';
    case 'list': return 'List<Data>';
    case 'unit': return 'Void';
    case 'unknown':
    case 'custom':
    default:
      return 'Data';  // Escape hatch for unknown types
  }
}

/**
 * Generate handler parameters based on script purpose
 * 
 * Plutus V3 handler signatures:
 * - spend(datum?, redeemer, output_ref, tx) - 4 params
 * - mint(redeemer, policy_id, tx) - 3 params  
 * - withdraw(redeemer, credential, tx) - 3 params
 * - publish(redeemer, certificate, tx) - 3 params
 * - vote(redeemer, voter, governance_action_id, tx) - 4 params
 * - propose(redeemer, proposal_procedure, tx) - 3 params
 */
function generateParams(structure: ContractStructure, opts: GeneratorOptions): ParameterInfo[] {
  const params = structure.params;
  const redeemerType = structure.redeemer?.variants?.length > 0 ? 'Action' : 'Data';
  const datumType = structure.datum?.isUsed && structure.datum.fields.length > 0 ? 'Datum' : 'Data';
  
  switch (structure.type) {
    case 'spend':
      return [
        { name: params[0] || 'datum', type: `Option<${datumType}>`, isOptional: true },
        { name: params[1] || 'redeemer', type: redeemerType },
        { name: params[2] || 'own_ref', type: 'OutputReference' },
        { name: params[3] || 'tx', type: 'Transaction' }
      ];
      
    case 'mint':
      return [
        { name: params[0] || 'redeemer', type: redeemerType },
        { name: params[1] || 'policy_id', type: 'PolicyId' },
        { name: params[2] || 'tx', type: 'Transaction' }
      ];
      
    case 'withdraw':
      return [
        { name: params[0] || 'redeemer', type: redeemerType },
        { name: params[1] || 'credential', type: 'Credential' },
        { name: params[2] || 'tx', type: 'Transaction' }
      ];
      
    case 'publish':
      return [
        { name: params[0] || 'redeemer', type: redeemerType },
        { name: params[1] || 'certificate', type: 'Certificate' },
        { name: params[2] || 'tx', type: 'Transaction' }
      ];
      
    case 'vote':
      return [
        { name: params[0] || 'redeemer', type: redeemerType },
        { name: params[1] || 'voter', type: 'Voter' },
        { name: params[2] || 'governance_action_id', type: 'GovernanceActionId' },
        { name: params[3] || 'tx', type: 'Transaction' }
      ];
      
    case 'propose':
      return [
        { name: params[0] || 'redeemer', type: redeemerType },
        { name: params[1] || 'proposal', type: 'ProposalProcedure' },
        { name: params[2] || 'tx', type: 'Transaction' }
      ];
      
    default:
      // Unknown - use generic spend-like signature
      return [
        { name: params[0] || 'datum', type: 'Option<Data>', isOptional: true },
        { name: params[1] || 'redeemer', type: redeemerType },
        { name: params[2] || 'ctx', type: 'ScriptContext' }
      ];
  }
}

// Global context for utility bindings during code generation
let currentUtilityBindings: Record<string, string> = {};

/**
 * Generate the handler body
 */
function generateHandlerBody(structure: ContractStructure, opts: GeneratorOptions): CodeBlock {
  const { redeemer, checks, rawBody, params, utilityBindings } = structure;
  
  // Set utility bindings for substitution
  currentUtilityBindings = utilityBindings || {};
  
  // If we have multiple redeemer variants, generate a when expression
  if (redeemer.variants.length > 1) {
    return generateWhenBlock(redeemer.variants, opts);
  }
  
  // If we have a raw body, try to generate code from it
  if (rawBody) {
    const expr = termToExpression(rawBody, params, 0);
    if (expr !== '???' && expr !== 'True') {
      return {
        kind: 'expression',
        content: expr
      };
    }
  }
  
  // If we have checks, generate condition chain
  if (checks.length > 0) {
    return generateChecksBlock(checks, opts);
  }
  
  // Fallback - just return True (always-succeeding validator)
  return {
    kind: 'expression',
    content: 'True'
  };
}

/**
 * Flatten a chain of nested lambdas into a list of params and the inner body
 * fn(a) { fn(b) { fn(c) { body } } } → params: [a, b, c], body: body
 * 
 * Only flattens up to 6 consecutive lambdas to keep readability
 */
function flattenLambdaChain(term: any, maxDepth: number = 6): { flatParams: string[], innerBody: any } {
  const flatParams: string[] = [];
  let current = term;
  
  while (current.tag === 'lam' && flatParams.length < maxDepth) {
    flatParams.push(current.param);
    current = current.body;
  }
  
  return { flatParams, innerBody: current };
}

/**
 * Convert a UPLC term to an Aiken-style expression string
 */
function termToExpression(term: any, params: string[], depth: number): string {
  if (!term || depth > 1000) return '???';
  
  switch (term.tag) {
    case 'con':
      return constToExpression(term);
      
    case 'var':
      // Check binding environment for resolved bindings - AGGRESSIVE INLINING
      if (bindingEnv && !inliningStack.has(term.name)) {
        const resolved = bindingEnv.get(term.name);
        if (resolved) {
          // Always inline constants
          if (resolved.category === 'inline' && resolved.inlineValue) {
            return resolved.inlineValue;
          }
          
          // Inline renamed bindings as their semantic name for predicates
          if (resolved.category === 'rename') {
            // For is_constr_N, keep as function name (used as predicate)
            if (resolved.pattern === 'is_constr_n' && resolved.semanticName) {
              return resolved.semanticName;
            }
            // For builtin wrappers, use builtin name
            if (resolved.pattern === 'builtin_wrapper' && resolved.semanticName) {
              return resolved.semanticName;
            }
            // For boolean combinators, use operator name
            if (resolved.pattern === 'boolean_and') return 'and';
            if (resolved.pattern === 'boolean_or') return 'or';
            // For partial builtins, use semantic name
            if (resolved.semanticName) {
              return resolved.semanticName;
            }
          }
          
          // For 'keep' bindings: inline based on context
          // At depth 0-5, allow larger inlining (top-level main logic)
          // At deeper levels, limit size to prevent blowup
          if (resolved.category === 'keep' && 
              resolved.pattern !== 'list_fold' && 
              depth < 50) {
            // Add to stack to prevent cycles
            inliningStack.add(term.name);
            try {
              const inlined = termToExpression(resolved.value, params, depth + 1);
              // At shallow depth, allow larger functions (e.g. main validator logic)
              // At deeper depth, be more conservative
              const maxLen = depth < 5 ? 10000 : 200;
              if (inlined.length < maxLen) {
                return inlined;
              }
            } finally {
              inliningStack.delete(term.name);
            }
          }
        }
      }
      
      // Check if this variable is a utility binding (substitute with builtin or predicate)
      if (currentUtilityBindings[term.name]) {
        const binding = currentUtilityBindings[term.name];
        if (binding.startsWith('is_constr_')) {
          return binding;
        }
        return binding;
      }
      
      // Check if this is an extracted helper that should be renamed
      const helper = extractedHelpers.get(term.name);
      if (helper && helper.helperName !== term.name) {
        return helper.helperName;
      }
      return term.name;
      
    case 'builtin':
      return `builtin::${term.name}`;
      
    case 'lam':
      // Try to flatten consecutive lambdas into multi-param function
      const { flatParams, innerBody } = flattenLambdaChain(term);
      const allParams = [...params, ...flatParams];
      const body = termToExpression(innerBody, allParams, depth + 1);
      
      // If we flattened multiple params, show as multi-param function
      if (flatParams.length > 1) {
        return `fn(${flatParams.join(', ')}) { ${body} }`;
      }
      return `fn(${term.param}) { ${body} }`;
      
    case 'app':
      return appToExpression(term, params, depth);
      
    case 'force':
      // Force just unwraps delay - invisible in Aiken
      return termToExpression(term.term, params, depth + 1);
      
    case 'delay':
      // Delay is for lazy evaluation - Aiken is strict, so just emit the inner term
      return termToExpression(term.term, params, depth + 1);
      
    case 'error':
      return 'fail';
      
    case 'case':
      return caseToExpression(term, params, depth);
      
    case 'constr':
      const args = term.args?.map((a: any) => termToExpression(a, params, depth + 1)).join(', ') || '';
      return `Constr(${term.index}${args ? ', ' + args : ''})`;
      
    default:
      return '???';
  }
}

/**
 * Convert a constant to expression
 */
function constToExpression(term: any): string {
  if (!term.value) return '()';
  
  switch (term.value.tag) {
    case 'integer':
      return term.value.value.toString();
    case 'bool':
      return term.value.value ? 'True' : 'False';
    case 'unit':
      return '()';
    case 'bytestring': {
      const val = term.value.value;
      // Handle both Uint8Array and plain object with numeric indices
      const bytes = val instanceof Uint8Array ? val : (Array.isArray(val) ? val : Object.values(val));
      const hex = Array.from(bytes as number[])
        .map((b: number) => b.toString(16).padStart(2, '0'))
        .join('');
      return `#"${hex}"`;
    }
    case 'string':
      return `"${term.value.value}"`;
    case 'data':
      // Handle Data-encoded values (con data B #..., con data I ..., etc.)
      return dataToExpression(term.value.value);
    default:
      return `<${term.type || 'data'}>`;
  }
}

/**
 * Convert a PlutusData value to expression
 * Handles: B (bytes), I (integer), List, Constr, Map
 */
function dataToExpression(data: any): string {
  if (!data) return '<data>';
  
  switch (data.tag) {
    case 'bytes': {
      // Data-encoded bytestring: B #hex
      const hex = typeof data.value === 'string' 
        ? data.value 
        : Array.from(data.value as number[]).map((b: number) => b.toString(16).padStart(2, '0')).join('');
      return `#"${hex}"`;
    }
    case 'int':
      return data.value.toString();
    case 'list':
      if (!data.value || data.value.length === 0) return '[]';
      return `[${data.value.map(dataToExpression).join(', ')}]`;
    case 'constr':
      const fields = data.fields?.map(dataToExpression).join(', ') || '';
      return `Constr(${data.index}${fields ? ', ' + fields : ''})`;
    case 'map':
      if (!data.value || data.value.length === 0) return '{}';
      const entries = data.value.map(([k, v]: [any, any]) => 
        `${dataToExpression(k)}: ${dataToExpression(v)}`
      ).join(', ');
      return `{ ${entries} }`;
    default:
      // Unknown data format - try to extract useful info
      if (typeof data === 'string') return `#"${data}"`;
      if (typeof data === 'bigint' || typeof data === 'number') return data.toString();
      return '<data>';
  }
}

/**
 * Unwrap force/delay wrappers to get the underlying term
 */
function unwrapForceDelay(term: any): any {
  while (term && (term.tag === 'force' || term.tag === 'delay')) {
    term = term.term;
  }
  return term;
}

/**
 * Convert function application to expression
 */
function appToExpression(term: any, params: string[], depth: number): string {
  // CRITICAL: Check for let-binding pattern ((lam x body) value)
  // Need to unwrap force/delay first: app(force(lam x body), delay(value))
  const unwrappedFunc = unwrapForceDelay(term.func);
  if (unwrappedFunc?.tag === 'lam') {
    // This is a let-binding: ((lam x body) value) or with force/delay wrappers
    // Just emit the body - the binding environment already knows about x
    return termToExpression(unwrappedFunc.body, params, depth + 1);
  }
  
  // Flatten nested applications
  const parts: any[] = [];
  let current = term;
  while (current.tag === 'app') {
    parts.unshift(current.arg);
    current = current.func;
  }
  // Handle force at the head
  while (current.tag === 'force') {
    current = current.term;
  }
  parts.unshift(current);
  
  // Check for transaction field access using new pattern detection
  if (txContextParam && parts[0]?.tag === 'builtin' && parts[0].name === 'headList') {
    const txField = detectTxField(term, txContextParam);
    if (txField) {
      return `tx.${txField}`;
    }
    
    // Also try legacy detection
    const txFieldLegacy = detectTxFieldAccess(term, txContextParam);
    if (txFieldLegacy) {
      return `tx.${txFieldLegacy.name}`;
    }
  }
  
  // Check for constructor match pattern → when/is
  if (parts[0]?.tag === 'builtin' && parts[0].name === 'ifThenElse') {
    const match = detectConstrMatch(term);
    if (match && match.branches.length >= 2) {
      const scrutinee = termToExpression(match.scrutinee, params, depth + 1);
      const branches = match.branches.map(b => 
        `    ${b.index} -> ${termToExpression(b.body, params, depth + 1)}`
      ).join('\n');
      const defaultBr = match.default 
        ? `\n    _ -> ${termToExpression(match.default, params, depth + 1)}`
        : '';
      return `when ${scrutinee} is {\n${branches}${defaultBr}\n  }`;
    }
    
    // Check for boolean chain → a && b && c
    const boolChain = detectBooleanChain(term);
    if (boolChain && boolChain.operands.length >= 2) {
      const op = boolChain.kind === 'and' ? ' && ' : ' || ';
      const operandStrs = boolChain.operands.map(o => termToExpression(o, params, depth + 1));
      return `(${operandStrs.join(op)})`;
    }
  }
  
  // Check binding environment for function calls
  if (parts[0]?.tag === 'var' && bindingEnv) {
    const resolved = bindingEnv.get(parts[0].name);
    if (resolved) {
      // Inline identity: id(x) → x
      if (resolved.pattern === 'identity' && parts.length === 2) {
        return termToExpression(parts[1], params, depth + 1);
      }
      // Inline apply: apply(f, x) → f(x)
      if (resolved.pattern === 'apply' && parts.length === 3) {
        const f = termToExpression(parts[1], params, depth + 1);
        const x = termToExpression(parts[2], params, depth + 1);
        return `${f}(${x})`;
      }
      // Use builtin for wrapper functions: to_int(x) → builtin call
      if (resolved.pattern === 'builtin_wrapper' && resolved.semanticName) {
        return builtinCallToExpression(resolved.semanticName, parts.slice(1), params, depth);
      }
      // Use semantic name for is_constr_N predicates
      if (resolved.pattern === 'is_constr_n' && resolved.semanticName) {
        const argExprs = parts.slice(1).map((a: any) => termToExpression(a, params, depth + 1));
        return `${resolved.semanticName}(${argExprs.join(', ')})`;
      }
      // Use semantic name for field accessors
      if (resolved.pattern === 'field_accessor' && resolved.semanticName) {
        const argExprs = parts.slice(1).map((a: any) => termToExpression(a, params, depth + 1));
        return `${resolved.semanticName}(${argExprs.join(', ')})`;
      }
      // Use semantic name for boolean and/or
      if ((resolved.pattern === 'boolean_and' || resolved.pattern === 'boolean_or') && resolved.semanticName) {
        const argExprs = parts.slice(1).map((a: any) => termToExpression(a, params, depth + 1));
        if (resolved.pattern === 'boolean_and' && argExprs.length === 2) {
          return `(${argExprs[0]} && ${argExprs[1]})`;
        }
        if (resolved.pattern === 'boolean_or' && argExprs.length === 2) {
          return `(${argExprs[0]} || ${argExprs[1]})`;
        }
      }
    }
  }
  
  // Check if function is an extracted helper that can be inlined (legacy path)
  if (parts[0]?.tag === 'var') {
    const helper = extractedHelpers.get(parts[0].name);
    if (helper) {
      // Inline identity function: id(x) → x
      if (helper.pattern === 'identity' && parts.length === 2) {
        return termToExpression(parts[1], params, depth + 1);
      }
      // Inline apply function: apply(f, x) → f(x)
      if (helper.pattern === 'apply' && parts.length === 3) {
        const f = termToExpression(parts[1], params, depth + 1);
        const x = termToExpression(parts[2], params, depth + 1);
        return `${f}(${x})`;
      }
    }
  }
  
  // Check if it's a builtin call
  if (parts[0]?.tag === 'builtin') {
    return builtinCallToExpression(parts[0].name, parts.slice(1), params, depth);
  }
  
  // Check if it's a utility binding being called (e.g., c(x) where c = headList)
  if (parts[0]?.tag === 'var' && currentUtilityBindings[parts[0].name]) {
    const bindingName = currentUtilityBindings[parts[0].name];
    
    // is_constr_N predicates are not builtins - call as regular function
    if (bindingName.startsWith('is_constr_')) {
      const argExprs = parts.slice(1).map((a: any) => termToExpression(a, params, depth + 1));
      return `${bindingName}(${argExprs.join(', ')})`;
    }
    
    return builtinCallToExpression(bindingName, parts.slice(1), params, depth);
  }
  
  // Regular function call - use helper name if available
  let funcName: string;
  if (parts[0]?.tag === 'var') {
    const helper = extractedHelpers.get(parts[0].name);
    funcName = helper?.helperName || parts[0].name;
  } else {
    funcName = termToExpression(parts[0], params, depth + 1);
  }
  
  const args = parts.slice(1).map((a: any) => termToExpression(a, params, depth + 1));
  
  if (args.length === 0) return funcName;
  return `${funcName}(${args.join(', ')})`;
}

/**
 * Convert builtin call to Aiken expression using stdlib mapping
 */
function builtinCallToExpression(name: string, args: any[], params: string[], depth: number): string {
  const argExprs = args.map((a: any) => termToExpression(a, params, depth + 1));
  
  // Track this builtin usage for import collection
  usedBuiltins.add(name);
  
  const mapping = BUILTIN_MAP[name];
  
  if (!mapping) {
    // Unknown builtin - use as-is
    return `${name}(${argExprs.join(', ')})`;
  }
  
  // Handle inline templates (operators, simple expressions)
  // Only use inline if we have enough arguments to fill all placeholders
  if (mapping.inline) {
    // Count required placeholders in template
    const placeholderCount = (mapping.inline.match(/\{\d+\}/g) || []).length;
    
    // Only use inline template if we have all required arguments
    if (argExprs.length >= placeholderCount) {
      let result = mapping.inline;
      argExprs.forEach((arg, i) => {
        result = result.replace(new RegExp(`\\{${i}\\}`, 'g'), arg);
      });
      return result;
    }
    
    // Fall through to function call for partial applications
  }
  
  const fnName = mapping.aikenName || name;
  
  // Handle method call style: x.method() or x.method(y)
  if (mapping.method && argExprs.length > 0) {
    const [first, ...rest] = argExprs;
    return rest.length > 0 
      ? `${first}.${fnName}(${rest.join(', ')})`
      : `${first}.${fnName}()`;
  }
  
  // Regular function call
  return `${fnName}(${argExprs.join(', ')})`;
}

/**
 * Convert case expression to when block
 */
function caseToExpression(term: any, params: string[], depth: number): string {
  const scrutinee = termToExpression(term.scrutinee, params, depth + 1);
  
  if (!term.branches || term.branches.length === 0) {
    return `when ${scrutinee} is { }`;
  }
  
  const branches = term.branches.map((b: any, i: number) => {
    const body = termToExpression(b, params, depth + 1);
    return `  ${i} -> ${body}`;
  }).join('\n');
  
  return `when ${scrutinee} is {\n${branches}\n}`;
}

/**
 * Generate a when expression for redeemer variants
 */
function generateWhenBlock(variants: RedeemerVariant[], opts: GeneratorOptions): CodeBlock {
  return {
    kind: 'when',
    content: 'redeemer',
    branches: variants.map((v, i) => ({
      pattern: getVariantName(i),
      body: {
        kind: 'expression',
        content: termToExpression(v.body, [], 0)
      }
    }))
  };
}

/**
 * Generate validation checks block
 */
function generateChecksBlock(checks: ValidationCheck[], opts: GeneratorOptions): CodeBlock {
  if (checks.length === 1) {
    return {
      kind: 'expression',
      content: formatCheck(checks[0])
    };
  }
  
  // Multiple checks - combine with and
  return {
    kind: 'expression',
    content: checks.map(formatCheck).join(' && ')
  };
}

/**
 * Format a single validation check
 */
function formatCheck(check: ValidationCheck): string {
  switch (check.type) {
    case 'signature':
      return 'list.has(tx.extra_signatories, required_signer)';
    case 'deadline':
      return 'check_deadline(tx.validity_range, deadline)';
    case 'value':
      return 'check_value(tx.outputs, expected_value)';
    case 'equality':
      return `${check.description}`;
    case 'comparison':
      return `${check.description}`;
    default:
      return `/* ${check.builtin}: ${check.description} */`;
  }
}

/**
 * Fragmented output structure for AI processing
 */
export interface FragmentedOutput {
  /** Fragment definitions with metadata */
  fragments: Array<{
    id: string;
    role: string;
    suggestedName: string;
    params: string[];
    returnType: string;
    builtins: string[];
    code: string;
  }>;
  /** Main validator code using fragments */
  mainCode: string;
  /** Combined output for AI */
  fullOutput: string;
}

/**
 * Generate fragmented output for AI consumption
 * 
 * This breaks the code into logical fragments that can be
 * processed and named individually by AI.
 */
export function generateFragmented(structure: ContractStructure): FragmentedOutput {
  // Reset state
  usedBuiltins = new Set();
  extractedHelpers = new Map();
  bindingEnv = null;
  currentUtilityBindings = {};
  
  if (!structure.rawBody) {
    return { fragments: [], mainCode: '', fullOutput: '' };
  }
  
  // Build binding environment from full AST (includes all let-bindings)
  bindingEnv = BindingEnvironment.build(structure.fullAst || structure.rawBody);
  currentUtilityBindings = structure.utilityBindings || {};
  
  // Extract fragments
  const bindings = bindingEnv.all();
  const fragmented = extractFragments(bindings, structure.rawBody, structure.params);
  
  // Generate code for each fragment
  const fragmentOutputs = fragmented.fragments.map(frag => {
    const code = termToExpression(frag.body, [], 0);
    return {
      id: frag.id,
      role: frag.role,
      suggestedName: frag.suggestedName || frag.name,
      params: frag.params,
      returnType: frag.returnType,
      builtins: frag.builtinsUsed.slice(0, 5),
      code
    };
  });
  
  // Generate main validator code (will use fragment references)
  const mainCode = termToExpression(structure.rawBody, structure.params, 0);
  
  // Build combined output
  const sections: string[] = [];
  
  // Group fragments by role
  const byRole = new Map<string, typeof fragmentOutputs>();
  for (const frag of fragmentOutputs) {
    if (!byRole.has(frag.role)) byRole.set(frag.role, []);
    byRole.get(frag.role)!.push(frag);
  }
  
  // Output fragments by role
  const roleOrder = ['fold', 'calculator', 'validator', 'extractor', 'combinator', 'constructor', 'helper'];
  for (const role of roleOrder) {
    const frags = byRole.get(role);
    if (!frags || frags.length === 0) continue;
    
    sections.push(`\n// ========== ${role.toUpperCase()} FRAGMENTS ==========`);
    
    for (const frag of frags) {
      sections.push(`
// [${frag.id}] ${frag.suggestedName}
// Role: ${frag.role} | Returns: ${frag.returnType}
// Uses: ${frag.builtins.join(', ') || 'none'}
fn ${frag.suggestedName}(${frag.params.join(', ')}) -> ${frag.returnType} {
  ${frag.code}
}`);
    }
  }
  
  // Add main validator
  sections.push(`\n// ========== MAIN VALIDATOR ==========`);
  sections.push(`validator {
  ${structure.type}(${structure.params.map((p, i) => {
    const types = ['Option<Datum>', 'Redeemer', 'OutputReference', 'Transaction'];
    return `${p}: ${types[i] || 'Data'}`;
  }).join(', ')}) {
    ${mainCode}
  }
}`);
  
  return {
    fragments: fragmentOutputs,
    mainCode,
    fullOutput: sections.join('\n')
  };
}
