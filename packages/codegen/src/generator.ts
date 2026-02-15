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

// ============ CodegenContext ============

/**
 * Shared module-level state, mutated across all scopes.
 */
interface SharedState {
  usedBuiltins: Set<string>;
  extractedHelpers: Map<string, ExtractedHelper>;
  txContextParam: string | null;
  currentUtilityBindings: Record<string, string>;
  fullAstRef: any;
  hoistedFunctions: string[];
  hoistedFnCounter: number;
  selfRecursiveParams: Map<string, string>;
  selfRecursiveCaptured: Map<string, string[]>;
  selfRecursiveArity: Map<string, number>;
}

/**
 * Encapsulates all generation state. Replaces 14 mutable globals.
 *
 * - `params`, `depth` are per-scope (change via helper methods)
 * - `emittedBindings` is shared normally, isolated for hoisted functions
 * - `bindingEnv` is shared; scope tracked via push/pop
 * - Everything in `shared` is module-level mutable state
 */
class CodegenContext {
  constructor(
    readonly params: string[],
    readonly depth: number,
    readonly bindingEnv: BindingEnvironment,
    readonly emittedBindings: Set<string>,
    readonly failBindings: Map<string, string>,
    readonly inliningStack: Set<string>,
    readonly pendingKeepBindings: Set<string>,
    readonly shared: SharedState,
  ) {}

  /** New context with extra params and incremented depth */
  withExtraParams(extra: string[]): CodegenContext {
    return new CodegenContext(
      [...this.params, ...extra],
      this.depth + 1,
      this.bindingEnv,
      this.emittedBindings,
      this.failBindings,
      this.inliningStack,
      this.pendingKeepBindings,
      this.shared,
    );
  }

  /** New context at depth+1 */
  deeper(): CodegenContext {
    return new CodegenContext(
      this.params,
      this.depth + 1,
      this.bindingEnv,
      this.emittedBindings,
      this.failBindings,
      this.inliningStack,
      this.pendingKeepBindings,
      this.shared,
    );
  }

  /** New context with isolated emittedBindings (for hoisted function bodies) */
  withIsolatedEmitted(): CodegenContext {
    return new CodegenContext(
      this.params,
      this.depth,
      this.bindingEnv,
      new Set<string>(),
      this.failBindings,
      this.inliningStack,
      this.pendingKeepBindings,
      this.shared,
    );
  }
}

// ============ Constants ============

const DEFAULT_OPTIONS: GeneratorOptions = {
  comments: true,
  namingStyle: 'generic',
  includeTypes: true,
  indent: '  '
};

// Common variant names for redeemer types
const VARIANT_NAMES = ['Cancel', 'Update', 'Claim', 'Execute', 'Withdraw', 'Deposit'];

// ============ Public API ============

/**
 * Generate code structure from contract analysis
 */
export function generateValidator(
  structure: ContractStructure,
  options?: Partial<GeneratorOptions>
): GeneratedCode {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Build binding environment from full AST
  let bindingEnv = new BindingEnvironment();
  if (structure.fullAst) {
    bindingEnv = BindingEnvironment.build(structure.fullAst);
  }

  // Extract helpers from raw body
  let extractedHelpersMap = new Map<string, ExtractedHelper>();
  if (structure.rawBody) {
    extractedHelpersMap = extractHelpers(structure.rawBody);
  }

  // Create shared state
  const shared: SharedState = {
    usedBuiltins: new Set(),
    extractedHelpers: extractedHelpersMap,
    txContextParam: structure.params[structure.params.length - 1] || null,
    currentUtilityBindings: structure.utilityBindings || {},
    fullAstRef: structure.fullAst || null,
    hoistedFunctions: [],
    hoistedFnCounter: 0,
    selfRecursiveParams: new Map(),
    selfRecursiveCaptured: new Map(),
    selfRecursiveArity: new Map(),
  };

  // Create initial context
  const ctx = new CodegenContext(
    structure.params,
    0,
    bindingEnv,
    new Set(),
    new Map(),
    new Set(),
    new Set(),
    shared,
  );

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
  const body = generateHandlerBody(structure, opts, ctx);

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
    params: [],
    handlers: [handler]
  };

  // Collect required imports from used builtins
  const imports = getRequiredImports(Array.from(shared.usedBuiltins));

  // Convert script parameters to output format
  const scriptParams = structure.scriptParams?.map(p => ({
    name: p.name,
    type: p.type as 'bytestring' | 'integer' | 'data',
    value: p.value
  }));

  return {
    validator,
    types,
    imports,
    scriptParams,
    hoistedFunctions: shared.hoistedFunctions.length > 0 ? shared.hoistedFunctions : undefined,
  };
}

/**
 * Fragmented output structure for AI processing
 */
export interface FragmentedOutput {
  fragments: Array<{
    id: string;
    role: string;
    suggestedName: string;
    params: string[];
    returnType: string;
    builtins: string[];
    code: string;
  }>;
  mainCode: string;
  fullOutput: string;
}

/**
 * Generate fragmented output for AI consumption
 */
export function generateFragmented(structure: ContractStructure): FragmentedOutput {
  // Build binding environment
  const bindingEnv = BindingEnvironment.build(structure.fullAst || structure.rawBody || { tag: 'error' } as any);

  const shared: SharedState = {
    usedBuiltins: new Set(),
    extractedHelpers: new Map(),
    txContextParam: null,
    currentUtilityBindings: structure.utilityBindings || {},
    fullAstRef: null,
    hoistedFunctions: [],
    hoistedFnCounter: 0,
    selfRecursiveParams: new Map(),
    selfRecursiveCaptured: new Map(),
    selfRecursiveArity: new Map(),
  };

  if (!structure.rawBody) {
    return { fragments: [], mainCode: '', fullOutput: '' };
  }

  const ctx = new CodegenContext(
    [],
    0,
    bindingEnv,
    new Set(),
    new Map(),
    new Set(),
    new Set(),
    shared,
  );

  // Extract fragments
  const bindings = bindingEnv.all();
  const fragmented = extractFragments(bindings, structure.rawBody, structure.params);

  // Generate code for each fragment
  const fragmentOutputs = fragmented.fragments.map(frag => {
    const code = termToExpression(frag.body, ctx);
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

  // Generate main validator code
  const mainCtx = new CodegenContext(
    structure.params,
    0,
    bindingEnv,
    new Set(),
    new Map(),
    new Set(),
    new Set(),
    shared,
  );
  const mainCode = termToExpression(structure.rawBody, mainCtx);

  // Build combined output
  const sections: string[] = [];

  const byRole = new Map<string, typeof fragmentOutputs>();
  for (const frag of fragmentOutputs) {
    if (!byRole.has(frag.role)) byRole.set(frag.role, []);
    byRole.get(frag.role)!.push(frag);
  }

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

// ============ Internal: Validator scaffolding ============

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

function purposeToHandlerKind(purpose: ScriptPurpose): HandlerBlock['kind'] {
  switch (purpose) {
    case 'spend': return 'spend';
    case 'mint': return 'mint';
    case 'withdraw': return 'withdraw';
    case 'publish': return 'publish';
    case 'vote': return 'vote';
    case 'propose': return 'propose';
    default: return 'spend';
  }
}

function getVariantName(index: number): string {
  return index < VARIANT_NAMES.length ? VARIANT_NAMES[index] : `Variant${index}`;
}

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

function generateDatumType(fields: import('@uplc/patterns').FieldInfo[]): TypeDefinition {
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

function inferFieldName(index: number, inferredType: string): string {
  const hints: Record<string, string[]> = {
    'ByteArray': ['owner', 'beneficiary', 'token_name', 'signature'],
    'Int': ['amount', 'deadline', 'index', 'count'],
    'unknown': ['value', 'data', 'param', 'arg']
  };
  const typeHints = hints[inferredType] || hints['unknown'];
  return index < typeHints.length ? typeHints[index] : `field_${index}`;
}

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
      return 'Data';
  }
}

function generateParams(structure: ContractStructure, opts: GeneratorOptions): ParameterInfo[] {
  const params = structure.params;
  const redeemerType = structure.redeemer?.variants?.length > 0 ? 'Action' : 'Data';
  const datumType = structure.datum?.isUsed && structure.datum.fields.length > 0 ? 'Datum' : 'Data';

  switch (structure.type) {
    case 'spend':
      return [
        { name: params[0] || 'datum', type: `Option<${datumType}>`, isOptional: true },
        { name: params[1] || 'redeemer', type: redeemerType },
        { name: params[2] || 'own_ref', type: 'Data' },
        { name: params[3] || 'tx', type: 'Data' }
      ];
    case 'mint':
      return [
        { name: params[0] || 'redeemer', type: redeemerType },
        { name: params[1] || 'policy_id', type: 'Data' },
        { name: params[2] || 'tx', type: 'Data' }
      ];
    case 'withdraw':
      return [
        { name: params[0] || 'redeemer', type: redeemerType },
        { name: params[1] || 'credential', type: 'Data' },
        { name: params[2] || 'tx', type: 'Data' }
      ];
    case 'publish':
      return [
        { name: params[0] || 'redeemer', type: redeemerType },
        { name: params[1] || 'certificate', type: 'Data' },
        { name: params[2] || 'tx', type: 'Data' }
      ];
    case 'vote':
      return [
        { name: params[0] || 'redeemer', type: redeemerType },
        { name: params[1] || 'voter', type: 'Data' },
        { name: params[2] || 'governance_action_id', type: 'Data' },
        { name: params[3] || 'tx', type: 'Data' }
      ];
    case 'propose':
      return [
        { name: params[0] || 'redeemer', type: redeemerType },
        { name: params[1] || 'proposal', type: 'Data' },
        { name: params[2] || 'tx', type: 'Data' }
      ];
    default:
      return [
        { name: params[0] || 'datum', type: 'Option<Data>', isOptional: true },
        { name: params[1] || 'redeemer', type: redeemerType },
        { name: params[2] || 'ctx', type: 'Data' }
      ];
  }
}

// ============ Internal: Handler body generation ============

function generateHandlerBody(structure: ContractStructure, opts: GeneratorOptions, ctx: CodegenContext): CodeBlock {
  const { redeemer, checks, rawBody } = structure;

  // If we have multiple redeemer variants, generate a when expression
  if (redeemer.variants.length > 1) {
    return generateWhenBlock(redeemer.variants, opts, ctx);
  }

  // If we have a raw body, try to generate code from it
  const bodyToProcess = structure.bodyWithBindings || rawBody;
  if (bodyToProcess) {
    const preamble = emitReferencedBindings(bodyToProcess, ctx);
    const expr = termToExpression(bodyToProcess, ctx);
    if (expr !== '???' && expr !== 'True') {
      const content = preamble ? preamble + '\n' + expr : expr;
      return { kind: 'expression', content };
    }
  }

  // If we have checks, generate condition chain
  if (checks.length > 0) {
    return generateChecksBlock(checks, opts);
  }

  // Fallback
  return { kind: 'expression', content: 'True' };
}

function generateWhenBlock(variants: RedeemerVariant[], opts: GeneratorOptions, ctx: CodegenContext): CodeBlock {
  return {
    kind: 'when',
    content: 'redeemer',
    branches: variants.map((v, i) => ({
      pattern: getVariantName(i),
      body: {
        kind: 'expression',
        content: termToExpression(v.body, new CodegenContext([], 0, ctx.bindingEnv, ctx.emittedBindings, ctx.failBindings, ctx.inliningStack, ctx.pendingKeepBindings, ctx.shared))
      }
    }))
  };
}

function generateChecksBlock(checks: ValidationCheck[], opts: GeneratorOptions): CodeBlock {
  if (checks.length === 1) {
    return { kind: 'expression', content: formatCheck(checks[0]) };
  }
  return {
    kind: 'expression',
    content: checks.map(formatCheck).join(' && ')
  };
}

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

// ============ Internal: Preamble emission ============

/**
 * Emit referenced keep-bindings as let-statements in dependency order.
 */
function emitReferencedBindings(body: any, ctx: CodegenContext): string {
  const { bindingEnv, params, shared } = ctx;

  // Step 1: Find all free variables referenced from the body
  const referencedVars = new Set<string>();
  collectFreeVars(body, referencedVars);

  // Step 2: Transitively collect all keep-bindings needed
  const needed = new Set<string>();
  const queue = [...referencedVars];
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (needed.has(name) || params.includes(name)) continue;
    const resolved = bindingEnv.get(name);
    if (!resolved || resolved.category !== 'keep') continue;
    const deps = new Set<string>();
    collectFreeVars(resolved.value, deps);
    let hasUndefinedDep = false;
    for (const dep of deps) {
      if (!params.includes(dep) && !bindingEnv.get(dep)) {
        hasUndefinedDep = true;
        break;
      }
    }
    if (hasUndefinedDep) continue;
    needed.add(name);
    for (const dep of deps) {
      if (!needed.has(dep)) queue.push(dep);
    }
  }

  if (needed.size === 0) return '';

  // Step 3: Topological sort
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(name: string) {
    if (visited.has(name) || !needed.has(name)) return;
    if (visiting.has(name)) return;
    visiting.add(name);

    const resolved = bindingEnv.get(name);
    if (resolved) {
      const deps = new Set<string>();
      collectFreeVars(resolved.value, deps);
      for (const dep of deps) {
        if (needed.has(dep) && dep !== name) visit(dep);
      }
    }

    visiting.delete(name);
    visited.add(name);
    sorted.push(name);
  }

  for (const name of needed) {
    visit(name);
  }

  // Step 4: Emit let-statements
  ctx.pendingKeepBindings.clear();
  for (const s of sorted) ctx.pendingKeepBindings.add(s);

  const lets: string[] = [];
  for (const name of sorted) {
    const resolved = bindingEnv.get(name);
    if (!resolved) continue;

    // Detect self-recursive lambdas → hoist to module level
    const value = unwrapForceDelay(resolved.value);
    if (value?.tag === 'lam' && isSelfRecursiveLambda(value)) {
      ctx.emittedBindings.add(name);
      const hoistResult = tryHoistSelfRecursive(value, name, { tag: 'var', name }, ctx.deeper());
      if (hoistResult !== null) {
        continue;
      }
    }

    ctx.inliningStack.add(name);
    const valueExpr = termToExpression(resolved.value, ctx.deeper());
    ctx.inliningStack.delete(name);

    if (valueExpr !== '???' && valueExpr !== name) {
      if (/^(trace @"[^"]*": )?fail$/.test(valueExpr.trim())) {
        ctx.failBindings.set(name, valueExpr);
        ctx.emittedBindings.add(name);
        continue;
      }
      lets.push(`let ${name} = ${valueExpr}`);
      ctx.emittedBindings.add(name);
    }
  }

  return lets.join('\n');
}

// ============ Internal: AST utilities (pure functions) ============

/** Collect free variable names referenced in a term */
function collectFreeVars(term: any, freeVars: Set<string>, bound: Set<string> = new Set()) {
  if (!term) return;
  switch (term.tag) {
    case 'var':
      if (!bound.has(term.name)) freeVars.add(term.name);
      break;
    case 'lam': {
      const inner = new Set(bound);
      inner.add(term.param);
      collectFreeVars(term.body, freeVars, inner);
      break;
    }
    case 'app':
      collectFreeVars(term.func, freeVars, bound);
      collectFreeVars(term.arg, freeVars, bound);
      break;
    case 'force': case 'delay':
      collectFreeVars(term.term, freeVars, bound);
      break;
    case 'case':
      collectFreeVars(term.scrutinee, freeVars, bound);
      term.branches?.forEach((b: any) => collectFreeVars(b, freeVars, bound));
      break;
    case 'constr':
      term.args?.forEach((a: any) => collectFreeVars(a, freeVars, bound));
      break;
  }
}

/**
 * Search the full AST for a let-binding of `name` whose value is a self-recursive lambda.
 */
function findSelfRecursiveLambdaBinding(ast: any, name: string): any | null {
  if (!ast) return null;
  if (ast.tag === 'app') {
    const func = unwrapForceDelay(ast.func);
    if (func?.tag === 'lam' && func.param === name) {
      const val = unwrapForceDelay(ast.arg);
      if (val?.tag === 'lam' && isSelfRecursiveLambda(val)) {
        return val;
      }
    }
    return findSelfRecursiveLambdaBinding(ast.func, name) || findSelfRecursiveLambdaBinding(ast.arg, name);
  }
  if (ast.tag === 'lam') return findSelfRecursiveLambdaBinding(ast.body, name);
  if (ast.tag === 'force' || ast.tag === 'delay') return findSelfRecursiveLambdaBinding(ast.term, name);
  if (ast.tag === 'case') {
    let result = findSelfRecursiveLambdaBinding(ast.scrutinee, name);
    if (result) return result;
    for (const b of (ast.branches || [])) {
      result = findSelfRecursiveLambdaBinding(b, name);
      if (result) return result;
    }
  }
  if (ast.tag === 'constr') {
    for (const a of (ast.args || [])) {
      const result = findSelfRecursiveLambdaBinding(a, name);
      if (result) return result;
    }
  }
  return null;
}

function detectSelfRecursiveLambda(term: any): string | null {
  let unwrapped = term;
  while (unwrapped?.tag === 'force' || unwrapped?.tag === 'delay') unwrapped = unwrapped.term;
  if (unwrapped?.tag !== 'lam') return null;
  const selfParam = unwrapped.param;
  if (hasSelfCall(unwrapped.body, selfParam)) return selfParam;
  return null;
}

/** Check if a term contains self-application: param(param, ...) */
function hasSelfCall(term: any, selfParam: string): boolean {
  if (!term) return false;
  if (term.tag === 'app') {
    const parts = flattenAppParts(term);
    if (parts[0]?.tag === 'var' && parts[0].name === selfParam &&
        parts[1]?.tag === 'var' && parts[1].name === selfParam) {
      return true;
    }
    return hasSelfCall(term.func, selfParam) || hasSelfCall(term.arg, selfParam);
  }
  if (term.tag === 'lam') {
    if (term.param === selfParam) return false;
    return hasSelfCall(term.body, selfParam);
  }
  if (term.tag === 'force' || term.tag === 'delay') return hasSelfCall(term.term, selfParam);
  if (term.tag === 'case') {
    return hasSelfCall(term.scrutinee, selfParam) ||
      (term.branches || []).some((b: any) => hasSelfCall(b, selfParam));
  }
  if (term.tag === 'constr') {
    return (term.args || []).some((a: any) => hasSelfCall(a, selfParam));
  }
  return false;
}

function flattenLambdaChain(term: any, maxDepth: number = 6): { flatParams: string[], innerBody: any } {
  const flatParams: string[] = [];
  let current = term;
  while (current.tag === 'lam' && flatParams.length < maxDepth) {
    flatParams.push(current.param);
    current = current.body;
  }
  return { flatParams, innerBody: current };
}

function isSelfRecursiveLambda(term: any): boolean {
  if (term.tag !== 'lam') return false;
  const selfParam = term.param;
  if (term.body?.tag !== 'lam') return false;
  return hasSelfCall(term.body, selfParam);
}

function flattenAppParts(term: any): any[] {
  const parts: any[] = [];
  let current = term;
  while (current?.tag === 'app') {
    parts.unshift(current.arg);
    current = current.func;
  }
  while (current && (current.tag === 'force' || current.tag === 'delay')) {
    current = current.term;
  }
  parts.unshift(current);
  return parts;
}

function getBuiltinHead(term: any): string | null {
  let current = term;
  while (current && (current.tag === 'force' || current.tag === 'delay')) {
    current = current.term;
  }
  return current?.tag === 'builtin' ? current.name : null;
}

function unwrapForceDelay(term: any): any {
  while (term && (term.tag === 'force' || term.tag === 'delay')) {
    term = term.term;
  }
  return term;
}

// ============ Internal: Self-recursive function hoisting ============

function tryHoistSelfRecursive(value: any, paramName: string, continuation: any, ctx: CodegenContext): string | null {
  const { bindingEnv, params, shared } = ctx;
  const selfParam = value.param;

  // Collect real params (all after self)
  const recParams: string[] = [];
  let innerBody = value.body;
  while (innerBody.tag === 'lam') {
    recParams.push(innerBody.param);
    innerBody = innerBody.body;
  }

  // Find free variables
  const freeInBody = new Set<string>();
  collectFreeVars(innerBody, freeInBody);
  freeInBody.delete(selfParam);
  for (const p of recParams) freeInBody.delete(p);

  // Check resolvability
  const isResolvableChecked = new Set<string>();
  const isResolvable = (v: string): boolean => {
    if (params.includes(v) || ctx.emittedBindings.has(v) || ctx.failBindings.has(v)) return true;
    if (ctx.pendingKeepBindings.has(v)) return true;
    if (isResolvableChecked.has(v)) return false;
    isResolvableChecked.add(v);
    const resolved = bindingEnv.get(v);
    if (!resolved) { isResolvableChecked.delete(v); return false; }
    if (resolved.category === 'inline' && resolved.inlineValue) { isResolvableChecked.delete(v); return true; }
    if (resolved.category === 'rename' && resolved.semanticName) {
      if (resolved.pattern === 'builtin_wrapper' || resolved.pattern === 'boolean_and' ||
          resolved.pattern === 'boolean_or' || resolved.pattern === 'is_constr_n' ||
          resolved.pattern === 'z_combinator' || resolved.pattern === 'list_fold') {
        isResolvableChecked.delete(v);
        return true;
      }
      if (resolved.value) {
        const deps = new Set<string>();
        collectFreeVars(resolved.value, deps);
        for (const dep of deps) {
          if (!params.includes(dep) && !ctx.emittedBindings.has(dep) && dep !== v) {
            if (!isResolvable(dep)) { isResolvableChecked.delete(v); return false; }
          }
        }
        isResolvableChecked.delete(v);
        return true;
      }
    }
    isResolvableChecked.delete(v);
    return false;
  };

  const hasUnresolvable = [...freeInBody].some(v => !isResolvable(v));
  if (hasUnresolvable) return null;

  const capturedVars = [...freeInBody].filter(isResolvable);
  const fnName = `rec_${shared.hoistedFnCounter++}`;

  shared.selfRecursiveParams.set(selfParam, fnName);

  const allParams = [...capturedVars, ...recParams];

  shared.selfRecursiveCaptured.set(selfParam, capturedVars);
  shared.selfRecursiveCaptured.set(paramName, capturedVars);
  shared.selfRecursiveArity.set(selfParam, recParams.length);
  shared.selfRecursiveArity.set(paramName, recParams.length);

  // Inner self-recursive lambda hoisting
  const innerHoisted: string[] = [];

  const hoistInnerSelfRecursive = (varName: string, cvValue: any) => {
    const innerSelf = cvValue.param;
    const innerRecParams: string[] = [];
    let innerInnerBody = cvValue.body;
    while (innerInnerBody.tag === 'lam') {
      innerRecParams.push(innerInnerBody.param);
      innerInnerBody = innerInnerBody.body;
    }
    const innerFree = new Set<string>();
    collectFreeVars(innerInnerBody, innerFree);
    innerFree.delete(innerSelf);
    for (const p of innerRecParams) innerFree.delete(p);
    const innerCaptured = [...innerFree].filter(v =>
      params.includes(v) || ctx.emittedBindings.has(v) || ctx.failBindings.has(v) ||
      capturedVars.includes(v) || recParams.includes(v) ||
      (bindingEnv.get(v)?.category === 'inline') ||
      (bindingEnv.get(v)?.category === 'rename')
    );
    const innerFnName = `rec_${shared.hoistedFnCounter++}`;
    shared.selfRecursiveParams.set(innerSelf, innerFnName);
    shared.selfRecursiveParams.set(varName, innerFnName);
    shared.selfRecursiveCaptured.set(innerSelf, innerCaptured);
    shared.selfRecursiveCaptured.set(varName, innerCaptured);
    shared.selfRecursiveArity.set(innerSelf, innerRecParams.length);
    shared.selfRecursiveArity.set(varName, innerRecParams.length);
    const innerAllParams = [...innerCaptured, ...innerRecParams];
    const innerCtx = ctx.withIsolatedEmitted().withExtraParams(innerRecParams);
    const innerFuncBody = termToExpression(innerInnerBody, innerCtx);
    shared.selfRecursiveParams.delete(innerSelf);
    shared.hoistedFunctions.push(`fn ${innerFnName}(${innerAllParams.join(', ')}) {\n  ${innerFuncBody}\n}`);
    innerHoisted.push(varName);
  };

  // Check captured vars for inner self-recursive lambdas
  for (const cv of capturedVars) {
    const cvResolved = bindingEnv.get(cv);
    let foundSelfRec = false;
    if (cvResolved?.value) {
      const cvValue = unwrapForceDelay(cvResolved.value);
      if (cvValue?.tag === 'lam' && isSelfRecursiveLambda(cvValue)) {
        hoistInnerSelfRecursive(cv, cvValue);
        foundSelfRec = true;
      }
    }
    if (!foundSelfRec && hasSelfCall(innerBody, cv) && shared.fullAstRef) {
      const selfRecLam = findSelfRecursiveLambdaBinding(shared.fullAstRef, cv);
      if (selfRecLam) {
        hoistInnerSelfRecursive(cv, selfRecLam);
      }
    }
  }

  // Check recParams for self-application
  for (const rp of recParams) {
    if (hasSelfCall(innerBody, rp)) {
      let foundSelfRec = false;
      const rpResolved = bindingEnv.get(rp);
      if (rpResolved?.value) {
        const rpValue = unwrapForceDelay(rpResolved.value);
        if (rpValue?.tag === 'lam' && isSelfRecursiveLambda(rpValue)) {
          hoistInnerSelfRecursive(rp, rpValue);
          foundSelfRec = true;
        }
      }
      if (!foundSelfRec && shared.fullAstRef) {
        const selfRecLam = findSelfRecursiveLambdaBinding(shared.fullAstRef, rp);
        if (selfRecLam) {
          hoistInnerSelfRecursive(rp, selfRecLam);
        }
      }
    }
  }

  // Generate function body with isolated emittedBindings
  const bodyCtx = ctx.withIsolatedEmitted().withExtraParams(recParams);
  const funcBody = termToExpression(innerBody, bodyCtx);

  shared.selfRecursiveParams.delete(selfParam);

  shared.hoistedFunctions.push(`fn ${fnName}(${allParams.join(', ')}) {\n  ${funcBody}\n}`);

  // Generate continuation
  shared.selfRecursiveParams.set(paramName, fnName);
  const contExpr = termToExpression(continuation, ctx);
  shared.selfRecursiveParams.delete(paramName);

  return contExpr;
}

// ============ Internal: Term → Expression ============

/**
 * Convert a UPLC term to an Aiken-style expression string
 */
function termToExpression(term: any, ctx: CodegenContext): string {
  if (!term || ctx.depth > 1000) return '???';
  const { params, depth, shared } = ctx;

  switch (term.tag) {
    case 'con':
      return constToExpression(term);

    case 'var':
      return varToExpression(term, ctx);

    case 'builtin':
      return bareBuiltinToExpression(term.name, shared.usedBuiltins);

    case 'lam': {
      const { flatParams, innerBody } = flattenLambdaChain(term);
      const lamCtx = ctx.withExtraParams(flatParams);
      const body = termToExpression(innerBody, lamCtx);
      if (flatParams.length > 1) {
        return `fn(${flatParams.join(', ')}) { ${body} }`;
      }
      return `fn(${term.param}) { ${body} }`;
    }

    case 'app':
      return appToExpression(term, ctx);

    case 'force':
      return termToExpression(term.term, ctx.deeper());

    case 'delay':
      return termToExpression(term.term, ctx.deeper());

    case 'error':
      return 'fail';

    case 'case':
      return caseToExpression(term, ctx);

    case 'constr': {
      shared.usedBuiltins.add('constrData');
      const constrArgs = term.args?.map((a: any) => {
        const expr = termToExpression(a, ctx.deeper());
        return wrapBoolAsData(expr, shared.usedBuiltins);
      }) || [];
      const constrFields = constrArgs.map((expr: string, i: number) => {
        const argNode = term.args?.[i];
        const unwrappedArg = argNode ? unwrapForceDelay(argNode) : null;
        if (unwrappedArg?.tag === 'lam' && !isBoolExpr(expr)) {
          return '[]';
        }
        return expr;
      });
      const fieldsList = constrFields.length > 0 ? `[${constrFields.join(', ')}]` : '[]';
      return `builtin.constr_data(${term.index}, ${fieldsList})`;
    }

    default:
      return '???';
  }
}

/**
 * Resolve a variable reference
 */
function varToExpression(term: any, ctx: CodegenContext): string {
  const { params, shared, bindingEnv } = ctx;
  const name = term.name;

  // Self-recursive params: remap self → function name
  if (shared.selfRecursiveParams.has(name)) {
    return shared.selfRecursiveParams.get(name)!;
  }

  // Lambda parameters shadow outer bindings
  if (params.includes(name)) {
    return name;
  }

  // Check fail-bindings
  if (ctx.failBindings.has(name)) {
    return ctx.failBindings.get(name)!;
  }

  // Check binding environment - AGGRESSIVE INLINING
  if (bindingEnv && !ctx.inliningStack.has(name)) {
    const resolved = bindingEnv.get(name);
    if (resolved) {
      // Always inline constants
      if (resolved.category === 'inline' && resolved.inlineValue) {
        return resolved.inlineValue;
      }

      // Inline renamed bindings
      if (resolved.category === 'rename') {
        if (resolved.pattern === 'is_constr_n' && resolved.semanticName) {
          const n = resolved.semanticName.replace('is_constr_', '');
          shared.usedBuiltins.add('fstPair');
          shared.usedBuiltins.add('unConstrData');
          return `fn(x) { builtin.fst_pair(builtin.un_constr_data(x)) == ${n} }`;
        }
        if (resolved.pattern === 'builtin_wrapper' && resolved.semanticName) {
          return bareBuiltinToExpression(resolved.semanticName, shared.usedBuiltins);
        }
        if (resolved.pattern === 'boolean_and') return 'and';
        if (resolved.pattern === 'boolean_or') return 'or';
        if (resolved.pattern === 'z_combinator') return name;
        if (resolved.pattern === 'list_fold') return name;

        // For partial builtins used as bare values
        if (resolved.pattern === 'partial_builtin' && resolved.value) {
          const boundParts = flattenAppParts(resolved.value);
          const builtinHead = getBuiltinHead(boundParts[0]);
          if (builtinHead) {
            const mapping = BUILTIN_MAP[builtinHead];
            const boundArgs = boundParts.slice(1);
            const remainingArity = (mapping?.arity || 2) - boundArgs.length;
            if (remainingArity > 0) {
              shared.usedBuiltins.add(builtinHead);
              const extraParams = Array.from({ length: remainingArity }, (_, i) =>
                String.fromCharCode(120 + i)
              );
              ctx.inliningStack.add(name);
              const boundArgExprs = boundArgs.map((a: any) => termToExpression(a, ctx.deeper()));
              ctx.inliningStack.delete(name);
              let body = mapping.inline;
              if (body) {
                const allExprs = [...boundArgExprs, ...extraParams];
                allExprs.forEach((arg, i) => {
                  body = body!.replace(new RegExp(`\\{${i}\\}`, 'g'), arg);
                });
                return `fn(${extraParams.join(', ')}) { ${body} }`;
              }
              const fnName = mapping.aikenName || builtinHead;
              const modulePrefix = mapping.module ? mapping.module.split('/').pop() : null;
              const qualifiedName = modulePrefix ? `${modulePrefix}.${fnName}` : fnName;
              return `fn(${extraParams.join(', ')}) { ${qualifiedName}(${[...boundArgExprs, ...extraParams].join(', ')}) }`;
            }
          }
        }

        // Other renames: try expanding semantic name
        if (resolved.semanticName) {
          const expanded = expandSemanticName(resolved.semanticName);
          if (expanded !== resolved.semanticName) {
            return expanded;
          }
          if (BUILTIN_MAP[resolved.semanticName]) {
            return bareBuiltinToExpression(resolved.semanticName, shared.usedBuiltins);
          }
        }

        // Inline the binding's value if not in scope
        if (resolved.value && !params.includes(name) && !ctx.emittedBindings.has(name)) {
          const freeVars = new Set<string>();
          collectFreeVars(resolved.value, freeVars);
          const hasRenameCycle = [...freeVars].some(fv => {
            if (ctx.inliningStack.has(fv)) return true;
            const dep = bindingEnv.get(fv);
            return dep?.category === 'rename' && !params.includes(fv) && !ctx.emittedBindings.has(fv);
          });
          if (!hasRenameCycle) {
            ctx.inliningStack.add(name);
            const result = termToExpression(resolved.value, ctx.deeper());
            ctx.inliningStack.delete(name);
            return result;
          }
        }
      }

      // 'keep' bindings whose value is fail
      if (resolved.category === 'keep' && ctx.failBindings.has(name)) {
        return ctx.failBindings.get(name)!;
      }
    }
  }

  // Utility bindings
  if (shared.currentUtilityBindings[name]) {
    const binding = shared.currentUtilityBindings[name];
    if (binding.startsWith('is_constr_')) {
      const n = binding.replace('is_constr_', '');
      shared.usedBuiltins.add('fstPair');
      shared.usedBuiltins.add('unConstrData');
      return `fn(x) { builtin.fst_pair(builtin.un_constr_data(x)) == ${n} }`;
    }
    if (BUILTIN_MAP[binding]) {
      return bareBuiltinToExpression(binding, shared.usedBuiltins);
    }
    return expandSemanticName(binding);
  }

  // Extracted helper rename
  const helper = shared.extractedHelpers.get(name);
  if (helper && helper.helperName !== name) {
    return helper.helperName;
  }
  return name;
}

// ============ Internal: Application → Expression ============

/**
 * Handle a let-binding pattern: ((lam x body) value)
 * Returns the generated expression, or null if not a let-binding.
 */
function handleLetBinding(term: any, unwrappedFunc: any, ctx: CodegenContext): string | null {
  if (unwrappedFunc?.tag !== 'lam') return null;

  const { depth, shared, bindingEnv } = ctx;
  const paramName = unwrappedFunc.param;
  const value = unwrapForceDelay(term.arg) || term.arg;

  // Check if BindingEnvironment can resolve this binding (skip the let)
  if (bindingEnv) {
    const resolved = bindingEnv.get(paramName);
    const isSameBinding = resolved && (resolved.value === value || resolved.value === term.arg);
    if (isSameBinding && resolved.category === 'inline' && resolved.inlineValue) {
      return termToExpression(unwrappedFunc.body, ctx.deeper());
    }
    if (isSameBinding && resolved.category === 'rename' && resolved.semanticName) {
      return termToExpression(unwrappedFunc.body, ctx.deeper());
    }
    if (isSameBinding && ctx.emittedBindings.has(paramName)) {
      return termToExpression(unwrappedFunc.body, ctx.deeper());
    }
  }

  // Self-recursive function detection → hoist to module level
  if (value.tag === 'lam' && isSelfRecursiveLambda(value)) {
    const hoistResult = tryHoistSelfRecursive(value, paramName, unwrappedFunc.body, ctx);
    if (hoistResult !== null) return hoistResult;
  }

  // Z/omega-combinator: fn(c) { c(c) }(fn(d, e) { ... d(d, ...) ... })
  const zResult = handleZCombinator(term, unwrappedFunc, ctx);
  if (zResult !== null) return zResult;

  // Analyze and register this inner binding in a new scope
  bindingEnv.push();
  const analyzed = bindingEnv.analyze(paramName, value);
  bindingEnv.set(paramName, analyzed);

  const valueExpr = termToExpression(value, ctx.deeper());

  // Skip `let x = fail` — inline fail at usage sites
  if (/^(trace @"[^"]*": )?fail$/.test(valueExpr.trim())) {
    ctx.failBindings.set(paramName, valueExpr);
    const bodyExpr = termToExpression(unwrappedFunc.body, ctx.deeper());
    bindingEnv.pop();
    return bodyExpr;
  }

  const isTrivialValue = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(valueExpr);

  if (!isTrivialValue) {
    ctx.inliningStack.add(paramName);
  }
  const bodyExpr = termToExpression(unwrappedFunc.body, ctx.deeper());
  if (!isTrivialValue) {
    ctx.inliningStack.delete(paramName);
  }

  bindingEnv.pop();

  if (isTrivialValue) return bodyExpr;

  if (bodyExpr === 'fail') {
    const traceMatch = valueExpr.match(/^trace @"([^"]*)": .+$/);
    if (traceMatch) return `trace @"${traceMatch[1]}": fail`;
    return 'fail';
  }

  const letExpr = `let ${paramName} = ${valueExpr}\n${bodyExpr}`;
  return depth > 0 ? `{\n${letExpr}\n}` : letExpr;
}

/**
 * Detect and handle Z/omega-combinator pattern:
 * fn(c) { c(c) }(fn(d, e) { ... d(d, ...) ... })
 */
function handleZCombinator(term: any, unwrappedFunc: any, ctx: CodegenContext): string | null {
  if (unwrappedFunc?.tag !== 'lam') return null;
  const zParam = unwrappedFunc.param;
  const zBody = unwrapForceDelay(unwrappedFunc.body);
  if (!(zBody?.tag === 'app' && zBody.func?.tag === 'var' && zBody.func.name === zParam
      && zBody.arg?.tag === 'var' && zBody.arg.name === zParam)) {
    return null;
  }
  const innerValue = unwrapForceDelay(term.arg);
  if (innerValue?.tag === 'lam' && isSelfRecursiveLambda(innerValue)) {
    const syntheticName = `_z${ctx.shared.hoistedFnCounter}`;
    return tryHoistSelfRecursive(innerValue, syntheticName, { tag: 'var', name: syntheticName }, ctx);
  }
  return null;
}

/**
 * Handle self-recursive call: self(self, args) → name(captured..., args)
 */
function handleSelfRecursiveCall(parts: any[], ctx: CodegenContext): string | null {
  const { shared } = ctx;
  if (!(parts[0]?.tag === 'var' && shared.selfRecursiveParams.has(parts[0].name))) return null;

  const fnName = shared.selfRecursiveParams.get(parts[0].name)!;
  const captured = shared.selfRecursiveCaptured.get(parts[0].name) || [];
  const expectedArity = shared.selfRecursiveArity.get(parts[0].name) || 0;
  const startIdx = (parts[1]?.tag === 'var' && parts[1].name === parts[0].name) ? 2 : 1;
  const argExprs = parts.slice(startIdx).map((p: any) => termToExpression(p, ctx.deeper()));
  const resolvedCaptured = captured.map(v =>
    termToExpression({ tag: 'var', name: v }, ctx.deeper())
  );
  const allArgs = [...resolvedCaptured, ...argExprs];
  if (argExprs.length < expectedArity) {
    const missing = expectedArity - argExprs.length;
    const etaParams = Array.from({ length: missing }, (_, i) => `_eta${i}`);
    const fullArgs = [...allArgs, ...etaParams];
    return `fn(${etaParams.join(', ')}) { ${fnName}(${fullArgs.join(', ')}) }`;
  }
  return allArgs.length > 0 ? `${fnName}(${allArgs.join(', ')})` : fnName;
}

/**
 * Handle calls to bindings with known patterns (identity, apply, builtin_wrapper, etc.)
 */
function handlePatternCall(parts: any[], ctx: CodegenContext): string | null {
  const { shared, bindingEnv } = ctx;

  if (!(parts[0]?.tag === 'var' && bindingEnv)) return null;
  const resolved = bindingEnv.get(parts[0].name);
  if (!resolved) return null;

  if (resolved.pattern === 'identity' && parts.length === 2) {
    return termToExpression(parts[1], ctx.deeper());
  }
  if (resolved.pattern === 'apply' && parts.length === 3) {
    const f = termToExpression(parts[1], ctx.deeper());
    const x = termToExpression(parts[2], ctx.deeper());
    return `${f}(${x})`;
  }
  if (resolved.pattern === 'builtin_wrapper' && resolved.semanticName) {
    return builtinCallToExpression(resolved.semanticName, parts.slice(1), ctx);
  }
  if (resolved.pattern === 'partial_builtin' && resolved.value) {
    const boundParts = flattenAppParts(resolved.value);
    const builtinHead = getBuiltinHead(boundParts[0]);
    if (builtinHead) {
      const boundArgs = boundParts.slice(1);
      const allArgs = [...boundArgs, ...parts.slice(1)];
      return builtinCallToExpression(builtinHead, allArgs, ctx);
    }
  }
  if (resolved.pattern === 'is_constr_n' && resolved.semanticName) {
    const n = resolved.semanticName.replace('is_constr_', '');
    shared.usedBuiltins.add('fstPair');
    shared.usedBuiltins.add('unConstrData');
    const argExprs = parts.slice(1).map((a: any) => termToExpression(a, ctx.deeper()));
    if (argExprs.length === 1) {
      return `builtin.fst_pair(builtin.un_constr_data(${argExprs[0]})) == ${n}`;
    }
    return `builtin.fst_pair(builtin.un_constr_data(${argExprs.join(', ')})) == ${n}`;
  }
  if (resolved.pattern === 'field_accessor' && resolved.semanticName) {
    const argExprs = parts.slice(1).map((a: any) => termToExpression(a, ctx.deeper()));
    return `${resolved.semanticName}(${argExprs.join(', ')})`;
  }
  if ((resolved.pattern === 'boolean_and' || resolved.pattern === 'boolean_or') && resolved.semanticName) {
    const argExprs = parts.slice(1).map((a: any) => termToExpression(a, ctx.deeper()));
    if (resolved.pattern === 'boolean_and' && argExprs.length === 2) {
      return `(${argExprs[0]} && ${argExprs[1]})`;
    }
    if (resolved.pattern === 'boolean_or' && argExprs.length === 2) {
      return `(${argExprs[0]} || ${argExprs[1]})`;
    }
  }

  return null;
}

/**
 * Handle calls to extracted helper functions (legacy path)
 */
function handleHelperCall(parts: any[], ctx: CodegenContext): string | null {
  if (!(parts[0]?.tag === 'var')) return null;
  const helper = ctx.shared.extractedHelpers.get(parts[0].name);
  if (!helper) return null;

  if (helper.pattern === 'identity' && parts.length === 2) {
    return termToExpression(parts[1], ctx.deeper());
  }
  if (helper.pattern === 'apply' && parts.length === 3) {
    const f = termToExpression(parts[1], ctx.deeper());
    const x = termToExpression(parts[2], ctx.deeper());
    return `${f}(${x})`;
  }
  return null;
}

function appToExpression(term: any, ctx: CodegenContext): string {
  const { shared, bindingEnv } = ctx;

  // Check for let-binding pattern ((lam x body) value)
  const unwrappedFunc = unwrapForceDelay(term.func);
  const letResult = handleLetBinding(term, unwrappedFunc, ctx);
  if (letResult !== null) return letResult;

  // Flatten nested applications
  const parts: any[] = [];
  let current = term;
  while (current.tag === 'app') {
    parts.unshift(current.arg);
    current = current.func;
  }
  while (current.tag === 'force') {
    current = current.term;
  }
  parts.unshift(current);

  // Check for transaction field access
  if (shared.txContextParam && parts[0]?.tag === 'builtin' && parts[0].name === 'headList') {
    const txField = detectTxField(term, shared.txContextParam);
    if (txField) {
      return `tx.${txField}`;
    }
    const txFieldLegacy = detectTxFieldAccess(term, shared.txContextParam);
    if (txFieldLegacy) {
      return `tx.${txFieldLegacy.name}`;
    }
  }

  // Check for constructor match pattern → when/is
  if (parts[0]?.tag === 'builtin' && parts[0].name === 'ifThenElse') {
    const match = detectConstrMatch(term);
    if (match && match.branches.length >= 2) {
      const scrutinee = termToExpression(match.scrutinee, ctx.deeper());
      const branches = match.branches.map(b =>
        `    ${b.index} -> ${termToExpression(b.body, ctx.deeper())}`
      ).join('\n');
      const defaultBr = match.default
        ? `\n    _ -> ${termToExpression(match.default, ctx.deeper())}`
        : '';
      return `when ${scrutinee} is {\n${branches}${defaultBr}\n  }`;
    }

    const boolChain = detectBooleanChain(term);
    if (boolChain && boolChain.operands.length >= 2) {
      const op = boolChain.kind === 'and' ? ' && ' : ' || ';
      const operandStrs = boolChain.operands.map(o => termToExpression(o, ctx.deeper()));
      return `(${operandStrs.join(op)})`;
    }
  }

  // Self-recursive call: self(self, args) → name(captured..., args)
  const selfRecResult = handleSelfRecursiveCall(parts, ctx);
  if (selfRecResult !== null) return selfRecResult;

  // Check binding environment for function calls
  const patternResult = handlePatternCall(parts, ctx);
  if (patternResult !== null) return patternResult;

  // Check extracted helpers (legacy path)
  const helperResult = handleHelperCall(parts, ctx);
  if (helperResult !== null) return helperResult;

  // Error applied to arguments
  if (parts[0]?.tag === 'error') {
    return 'fail';
  }

  // Builtin call
  if (parts[0]?.tag === 'builtin') {
    return builtinCallToExpression(parts[0].name, parts.slice(1), ctx);
  }

  // Utility binding call
  if (parts[0]?.tag === 'var' && shared.currentUtilityBindings[parts[0].name]) {
    const bindingName = shared.currentUtilityBindings[parts[0].name];
    if (bindingName.startsWith('is_constr_')) {
      const n = bindingName.replace('is_constr_', '');
      shared.usedBuiltins.add('fstPair');
      shared.usedBuiltins.add('unConstrData');
      const argExprs = parts.slice(1).map((a: any) => termToExpression(a, ctx.deeper()));
      if (argExprs.length === 1) {
        return `builtin.fst_pair(builtin.un_constr_data(${argExprs[0]})) == ${n}`;
      }
      return `builtin.fst_pair(builtin.un_constr_data(${argExprs.join(', ')})) == ${n}`;
    }
    return builtinCallToExpression(bindingName, parts.slice(1), ctx);
  }

  // Regular function call
  let funcName: string;
  if (parts[0]?.tag === 'var') {
    const helper = shared.extractedHelpers.get(parts[0].name);
    funcName = helper?.helperName || parts[0].name;
  } else {
    funcName = termToExpression(parts[0], ctx.deeper());
  }

  const args = parts.slice(1).map((a: any) => termToExpression(a, ctx.deeper()));

  if (args.length === 0) return funcName;
  return `${funcName}(${args.join(', ')})`;
}

// ============ Internal: Builtin expression generation ============

function expandSemanticName(name: string): string {
  const match = name.match(/^(is_constr|eq|lt|lte|gt|gte|add|sub|mul|div|mod|quotient|remainder)_(\d+)$/);
  if (!match) return name;
  const [, op, numStr] = match;
  const n = numStr;
  switch (op) {
    case 'is_constr': return `fn(x) { builtin.fst_pair(builtin.un_constr_data(x)) == ${n} }`;
    case 'eq': return `fn(x) { x == ${n} }`;
    case 'lt': return `fn(x) { x < ${n} }`;
    case 'lte': return `fn(x) { x <= ${n} }`;
    case 'gt': return `fn(x) { x > ${n} }`;
    case 'gte': return `fn(x) { x >= ${n} }`;
    case 'add': return `fn(x) { x + ${n} }`;
    case 'sub': return `fn(x) { x - ${n} }`;
    case 'mul': return `fn(x) { x * ${n} }`;
    case 'div': return `fn(x) { x / ${n} }`;
    case 'mod': return `fn(x) { x % ${n} }`;
    case 'quotient': return `fn(x) { x / ${n} }`;
    case 'remainder': return `fn(x) { x % ${n} }`;
    default: return name;
  }
}

function bareBuiltinToExpression(name: string, usedBuiltins: Set<string>): string {
  usedBuiltins.add(name);
  const mapping = BUILTIN_MAP[name];
  if (!mapping) {
    return name;
  }

  if (mapping.inline) {
    const placeholders = mapping.inline.match(/\{\d+\}/g) || [];
    const argCount = new Set(placeholders.map(p => p.replace(/[{}]/g, ''))).size;
    const argNames = Array.from({ length: argCount }, (_, i) =>
      String.fromCharCode(97 + i)
    );
    let body = mapping.inline;
    argNames.forEach((arg, i) => {
      body = body.replace(new RegExp(`\\{${i}\\}`, 'g'), arg);
    });
    return argCount === 0 ? body : `fn(${argNames.join(', ')}) { ${body} }`;
  }

  const fnName = mapping.aikenName || name;
  if (mapping.method) {
    return `fn(a) { a.${fnName}() }`;
  }

  const modulePrefix = mapping.module ? mapping.module.split('/').pop() : null;
  const qualifiedName = modulePrefix ? `${modulePrefix}.${fnName}` : fnName;
  return `fn(a) { ${qualifiedName}(a) }`;
}

function isBoolExpr(expr: string): boolean {
  const trimmed = expr.trim();
  if (trimmed === 'True' || trimmed === 'False') return true;
  if (/[^=!<>]==[^=]/.test(trimmed) || /!=/.test(trimmed)) return true;
  if (/[^<]<[^<]/.test(trimmed) || /[^>]>[^>]/.test(trimmed)) return true;
  if (/<=/.test(trimmed) || />=/.test(trimmed)) return true;
  if (/\&\&/.test(trimmed) || /\|\|/.test(trimmed)) return true;
  if (/builtin\.(equals_bytearray|less_than_bytearray|less_than_equals_bytearray|equals_string)\(/.test(trimmed)) return true;
  return false;
}

function wrapBoolAsData(expr: string, usedBuiltins: Set<string>): string {
  if (!isBoolExpr(expr)) return expr;
  usedBuiltins.add('constrData');
  return `if ${expr} { builtin.constr_data(1, []) } else { builtin.constr_data(0, []) }`;
}

function builtinCallToExpression(name: string, args: any[], ctx: CodegenContext): string {
  const { shared } = ctx;

  // Church-pair detection for fst_pair/snd_pair
  if ((name === 'fstPair' || name === 'sndPair') && args.length >= 1) {
    const pairArg = unwrapForceDelay(args[0]);
    const isChurchPair = pairArg?.tag === 'lam';
    if (isChurchPair) {
      const pairExpr = termToExpression(args[0], ctx.deeper());
      if (name === 'fstPair') {
        return `${pairExpr}(True)(Void)`;
      } else {
        return `${pairExpr}(Void)(True)`;
      }
    }
  }

  // Church-boolean in if condition
  if (name === 'ifThenElse' && args.length >= 3) {
    const condArg = unwrapForceDelay(args[0]);
    if (condArg?.tag === 'lam') {
      const condExpr = termToExpression(args[0], ctx.deeper());
      const thenExpr = termToExpression(args[1], ctx.deeper());
      const elseExpr = termToExpression(args[2], ctx.deeper());
      return `{ let cond_tmp = ${condExpr}(True)\n  if cond_tmp { ${thenExpr} } else { ${elseExpr} } }`;
    }
  }

  const argExprs = args.map((a: any) => termToExpression(a, ctx.deeper()));

  shared.usedBuiltins.add(name);

  const mapping = BUILTIN_MAP[name];

  if (!mapping) {
    return `${name}(${argExprs.join(', ')})`;
  }

  // Special handling for ifThenElse
  if (name === 'ifThenElse' && argExprs.length >= 3) {
    let cond = argExprs[0];
    if (/^(if |when |let |fn\()/.test(cond.trim())) {
      return `{ let cond_tmp = ${cond}\n  if cond_tmp { ${argExprs[1]} } else { ${argExprs[2]} } }`;
    }
    return `if ${cond} { ${argExprs[1]} } else { ${argExprs[2]} }`;
  }

  // Handle inline templates
  if (mapping.inline) {
    const placeholderCount = (mapping.inline.match(/\{\d+\}/g) || []).length;

    if (argExprs.length >= placeholderCount) {
      let result = mapping.inline;
      const templateArgs = [...argExprs];
      if (name === 'trace') {
        let msg = templateArgs[0] || '';
        if (msg.startsWith('"') && msg.endsWith('"')) {
          msg = msg.slice(1, -1);
        }
        templateArgs[0] = msg.replace(/"/g, "'");
      }
      templateArgs.forEach((arg, i) => {
        result = result.replace(new RegExp(`\\{${i}\\}`, 'g'), arg);
      });
      return result;
    }

    if (argExprs.length > 0 && argExprs.length < placeholderCount) {
      const remaining = placeholderCount - argExprs.length;
      const extraParams = Array.from({ length: remaining }, (_, i) =>
        String.fromCharCode(112 + i)
      );
      let body = mapping.inline;
      const allArgs = [...argExprs, ...extraParams];
      if (name === 'trace') {
        let msg = allArgs[0] || '';
        if (msg.startsWith('"') && msg.endsWith('"')) {
          msg = msg.slice(1, -1);
        }
        allArgs[0] = msg.replace(/"/g, "'");
      }
      allArgs.forEach((arg, i) => {
        body = body.replace(new RegExp(`\\{${i}\\}`, 'g'), arg);
      });
      return `fn(${extraParams.join(', ')}) { ${body} }`;
    }
  }

  const fnName = mapping.aikenName || name;

  // Method call style
  if (mapping.method && argExprs.length > 0) {
    const [first, ...rest] = argExprs;
    if (first.startsWith('fn(') || first.startsWith('if ') || first.startsWith('when ')) {
      const modulePrefix = mapping.module ? mapping.module.split('/').pop() : null;
      const qualifiedName = modulePrefix ? `${modulePrefix}.${fnName}` : fnName;
      return `${qualifiedName}(${argExprs.join(', ')})`;
    }
    return rest.length > 0
      ? `${first}.${fnName}(${rest.join(', ')})`
      : `${first}.${fnName}()`;
  }

  // Regular function call
  const modulePrefix = mapping.module ? mapping.module.split('/').pop() : null;
  const qualifiedName = modulePrefix ? `${modulePrefix}.${fnName}` : fnName;
  if (mapping.arity && argExprs.length > mapping.arity) {
    const primary = argExprs.slice(0, mapping.arity);
    const excess = argExprs.slice(mapping.arity);
    return `${qualifiedName}(${primary.join(', ')})(${excess.join(', ')})`;
  }
  return `${qualifiedName}(${argExprs.join(', ')})`;
}

// ============ Internal: Constant/data expressions ============

function constToExpression(term: any): string {
  if (!term.value) return 'Void';

  switch (term.value.tag) {
    case 'integer':
      return term.value.value.toString();
    case 'bool':
      return term.value.value ? 'True' : 'False';
    case 'unit':
      return 'Void';
    case 'bytestring': {
      const val = term.value.value;
      const bytes = val instanceof Uint8Array ? val : (Array.isArray(val) ? val : Object.values(val));
      const hex = Array.from(bytes as number[])
        .map((b: number) => b.toString(16).padStart(2, '0'))
        .join('');
      return `#"${hex}"`;
    }
    case 'string':
      return `"${term.value.value}"`;
    case 'data':
      return dataToExpression(term.value.value);
    case 'list': {
      const items = term.value.items || term.value.value || term.value.list || [];
      if (!Array.isArray(items) || items.length === 0) return '[]';
      const itemExprs = items.map((item: any) => {
        if (item?.tag === 'data' && item?.value) return dataToExpression(item.value);
        if (item?.tag) return constToExpression({ value: item });
        return dataToExpression(item);
      });
      return `[${itemExprs.join(', ')}]`;
    }
    case 'pair': {
      const fst = term.value.fst ? dataToExpression(term.value.fst) : '???';
      const snd = term.value.snd ? dataToExpression(term.value.snd) : '???';
      return `(${fst}, ${snd})`;
    }
    default:
      return 'Void';
  }
}

function dataToExpression(data: any): string {
  if (!data) return 'Void';

  switch (data.tag) {
    case 'bytes': {
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
    case 'constr': {
      const dataFields = data.fields?.map(dataToExpression).join(', ') || '';
      const dataFieldsList = dataFields ? `[${dataFields}]` : '[]';
      return `builtin.constr_data(${data.index}, ${dataFieldsList})`;
    }
    case 'map':
      if (!data.value || data.value.length === 0) return '[]';
      const entries = data.value.map(([k, v]: [any, any]) =>
        `Pair(${dataToExpression(k)}, ${dataToExpression(v)})`
      ).join(', ');
      return `[${entries}]`;
    default:
      if (typeof data === 'string') return `#"${data}"`;
      if (typeof data === 'bigint' || typeof data === 'number') return data.toString();
      return 'Void';
  }
}

function caseToExpression(term: any, ctx: CodegenContext): string {
  const scrutinee = termToExpression(term.scrutinee, ctx.deeper());

  if (!term.branches || term.branches.length === 0) {
    return `when ${scrutinee} is { }`;
  }

  const branches = term.branches.map((b: any, i: number) => {
    const body = termToExpression(b, ctx.deeper());
    return `  ${i} -> ${body}`;
  }).join('\n');

  return `when ${scrutinee} is {\n${branches}\n}`;
}
