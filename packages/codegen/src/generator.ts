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

// Track builtins used during code generation (reset per generateValidator call)
let usedBuiltins: Set<string> = new Set();

// Track extracted helpers during code generation
let extractedHelpers: Map<string, ExtractedHelper> = new Map();

// Track which parameters are the transaction context
let txContextParam: string | null = null;

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
  
  // Extract helper functions from the raw body
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
  
  return { validator, types, imports };
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
      // Check if this variable is a utility binding (substitute with builtin or predicate)
      if (currentUtilityBindings[term.name]) {
        const binding = currentUtilityBindings[term.name];
        // is_constr_N predicates are not builtins, just use the name directly
        if (binding.startsWith('is_constr_')) {
          return binding;
        }
        return `builtin::${binding}`;
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
      return termToExpression(term.term, params, depth + 1);
      
    case 'delay':
      return `delay { ${termToExpression(term.term, params, depth + 1)} }`;
      
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
    case 'bytestring':
      const hex = Array.from(term.value.value as Uint8Array)
        .map((b: number) => b.toString(16).padStart(2, '0'))
        .join('');
      return `#"${hex}"`;
    case 'string':
      return `"${term.value.value}"`;
    default:
      return `<${term.type || 'data'}>`;
  }
}

/**
 * Convert function application to expression
 */
function appToExpression(term: any, params: string[], depth: number): string {
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
  
  // Check for transaction field access pattern (headList(tailList^n(sndPair(unConstrData(tx)))))
  if (txContextParam && parts[0]?.tag === 'builtin' && parts[0].name === 'headList') {
    const txField = detectTxFieldAccess(term, txContextParam);
    if (txField) {
      return `tx.${txField.name}`;
    }
  }
  
  // Check if function is an extracted helper that can be inlined
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
  if (mapping.inline) {
    let result = mapping.inline;
    argExprs.forEach((arg, i) => {
      result = result.replace(new RegExp(`\\{${i}\\}`, 'g'), arg);
    });
    return result;
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
