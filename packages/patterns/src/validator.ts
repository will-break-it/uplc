/**
 * Validator Entry Point Detection
 * 
 * Detects whether a contract is a spend validator, minting policy, 
 * withdraw, publish, vote, or propose handler.
 * 
 * Plutus V3 (Aiken-compiled) pattern:
 *   (lam outer_param
 *     (case (constr 0 utilities...)
 *       (lam a (lam b (lam c ... BODY)))))  <- real validator params
 * 
 * Simple pattern:
 *   (lam datum (lam redeemer (lam ctx BODY)))
 */
import type { UplcTerm } from '@uplc/parser';

export type ScriptPurpose = 
  | 'spend'           // 4 params: datum?, redeemer, output_ref, tx
  | 'mint'            // 3 params: redeemer, policy_id, tx
  | 'withdraw'        // 3 params: redeemer, credential, tx
  | 'publish'         // 3 params: redeemer, certificate, tx
  | 'vote'            // 4 params: redeemer, voter, governance_action_id, tx
  | 'propose'         // 3 params: redeemer, proposal_procedure, tx
  | 'unknown';

export interface ScriptParameter {
  name: string;      // Generated name like PARAM_0 or SCRIPT_HASH
  type: string;      // 'bytestring' | 'integer' | 'data'
  value: string;     // Hex string or numeric value
}

export interface ValidatorInfo {
  type: ScriptPurpose;
  params: string[];
  body: UplcTerm;
  utilities?: UplcTerm;  // The constr with utility functions if detected
  utilityBindings?: Record<string, string>;  // Map param names to builtin names
  scriptParams?: ScriptParameter[];  // Top-level parameterized constants
}

/**
 * Detect the validator entry point structure
 */
export function detectValidator(ast: UplcTerm): ValidatorInfo {
  // First unwrap any top-level parameter applications
  const { inner, params: scriptParams } = unwrapParameterApplications(ast);
  
  // Try Plutus V3 pattern detection
  const v3Result = detectV3Pattern(inner);
  if (v3Result) {
    v3Result.scriptParams = scriptParams.length > 0 ? scriptParams : undefined;
    return v3Result;
  }
  
  // Fall back to simple lambda counting
  const simpleResult = detectSimplePattern(inner);
  simpleResult.scriptParams = scriptParams.length > 0 ? scriptParams : undefined;
  return simpleResult;
}

/**
 * Unwrap top-level applications that pass constants into the script.
 * Pattern: [[script_body] const1] const2] ...
 * Returns the inner script body and extracted parameters.
 */
function unwrapParameterApplications(ast: UplcTerm): { inner: UplcTerm; params: ScriptParameter[] } {
  const params: ScriptParameter[] = [];
  let current = ast;
  let paramIndex = 0;
  
  // Unwrap applications where the arg is a constant
  while (current.tag === 'app') {
    const arg = current.arg;
    
    if (arg.tag === 'con') {
      const param = extractConstantParam(arg, paramIndex);
      if (param) {
        params.unshift(param);  // Prepend since we're unwrapping inside-out
        paramIndex++;
      }
      current = current.func;
    } else {
      // Not a constant arg - stop unwrapping
      break;
    }
  }
  
  return { inner: current, params };
}

/**
 * Extract a script parameter from a constant term
 */
function extractConstantParam(term: any, index: number): ScriptParameter | null {
  if (term.tag !== 'con') return null;
  
  const type = term.type;
  const value = term.value;
  
  if (type === 'bytestring' || value?.tag === 'bytestring') {
    const bytes = value?.value || value;
    const hex = bytesToHex(bytes);
    const name = hex.length === 56 ? `SCRIPT_HASH_${index}` 
               : hex.length === 64 ? `POLICY_ID_${index}`
               : `PARAM_${index}`;
    return { name, type: 'bytestring', value: hex };
  }
  
  if (type === 'integer' || value?.tag === 'integer') {
    const num = value?.value ?? value;
    return { name: `PARAM_${index}`, type: 'integer', value: num.toString() };
  }
  
  if (type === 'data' || value?.tag === 'data') {
    // Handle Data-encoded values
    const innerValue = value?.value || value;
    if (innerValue?.tag === 'bytes') {
      const hex = typeof innerValue.value === 'string' 
        ? innerValue.value 
        : bytesToHex(innerValue.value);
      const name = hex.length === 56 ? `SCRIPT_HASH_${index}` 
                 : hex.length === 64 ? `POLICY_ID_${index}`
                 : `PARAM_${index}`;
      return { name, type: 'bytestring', value: hex };
    }
    if (innerValue?.tag === 'int') {
      return { name: `PARAM_${index}`, type: 'integer', value: innerValue.value.toString() };
    }
  }
  
  return null;
}

/**
 * Convert bytes to hex string
 */
function bytesToHex(bytes: any): string {
  if (typeof bytes === 'string') return bytes;
  if (bytes instanceof Uint8Array) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  if (bytes && typeof bytes === 'object') {
    return Array.from(Object.values(bytes) as number[]).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return '';
}

/**
 * Detect Plutus V3 (Aiken-compiled) pattern:
 * (lam outer (case (constr 0 utils...) (lam a (lam b ... BODY))))
 */
function detectV3Pattern(ast: UplcTerm): ValidatorInfo | null {
  // Must start with a lambda
  if (ast.tag !== 'lam') return null;
  
  const outerParam = ast.param;  // This is the ScriptContext in V3
  const caseExpr = ast.body;
  
  // Body must be a case expression
  if (caseExpr.tag !== 'case') return null;
  
  // Scrutinee should be a constr (utility functions)
  const scrutinee = caseExpr.scrutinee;
  if (scrutinee.tag !== 'constr') return null;
  
  // Should have at least one branch (the actual validator)
  if (caseExpr.branches.length < 1) return null;
  
  const validatorBranch = caseExpr.branches[0];
  
  // Extract params from the branch (these bind to the constr args)
  const branchParams: string[] = [];
  let current: UplcTerm = validatorBranch;
  
  while (current.tag === 'lam') {
    branchParams.push(current.param);
    current = current.body;
  }
  
  // Build utility bindings map: param name -> builtin name
  const utilityBindings: Record<string, string> = {};
  const utilityArgs = scrutinee.tag === 'constr' ? scrutinee.args || [] : [];
  const realParams: string[] = [];
  
  for (let i = 0; i < branchParams.length; i++) {
    const paramName = branchParams[i];
    
    if (i < utilityArgs.length) {
      const arg = utilityArgs[i];
      const builtinName = extractBuiltinName(arg);
      if (builtinName) {
        utilityBindings[paramName] = builtinName;
      } else {
        // Not a builtin - might be a value passed through constr
        realParams.push(paramName);
      }
    } else {
      // Beyond utility count - these are real params
      realParams.push(paramName);
    }
  }
  
  // In Plutus V3, the outer lambda param is the ScriptContext
  // The real "params" are: [scriptContext, ...any non-utility branch params]
  const params = [outerParam, ...realParams];
  
  // Detect purpose - in V3, we need to analyze what the script does with the context
  // For now, default to 'spend' for V3 scripts
  const purpose = inferPurposeFromParams(params, current);
  
  return {
    type: purpose,
    params,
    body: current,
    utilities: scrutinee,
    utilityBindings
  };
}

/**
 * Extract builtin name from a term (possibly wrapped in force)
 */
function extractBuiltinName(term: UplcTerm): string | null {
  if (term.tag === 'builtin') {
    return term.name;
  }
  if (term.tag === 'force') {
    return extractBuiltinName(term.term);
  }
  return null;
}

/**
 * Extract a meaningful name for a utility binding
 * Handles:
 * - Simple builtins: (force (builtin headList)) → "headList"
 * - Partial applications: [(builtin equalsInteger) (con integer 0)] → "is_constr_0"
 */
function extractUtilityName(term: UplcTerm): string | null {
  // Simple builtin (possibly forced)
  const simpleName = extractBuiltinName(term);
  if (simpleName) return simpleName;
  
  // Partial application pattern: [builtin arg]
  if (term.tag === 'app') {
    const builtinName = extractBuiltinName(term.func);
    if (!builtinName) return null;
    
    // [(builtin equalsInteger) (con integer N)] → is_constr_N
    if (builtinName === 'equalsInteger' && term.arg.tag === 'con') {
      const value = term.arg.value;
      if (value.tag === 'integer') {
        return `is_constr_${value.value}`;
      }
    }
    
    // Other partial applications - return builtin name
    return builtinName;
  }
  
  return null;
}

/**
 * Simple pattern: Detect Plutus-style utility binding pattern
 * Handles:
 * 1. Parameterized scripts: [[[lam a [lam b ...]] param1] param2] param3]
 * 2. Nested utility bindings: ((lam i_0 ((lam i_1 BODY) util1)) util0)
 * 3. Mixed utility/script params: [[[lam a [lam b ...]] builtin1] builtin2] data_param]
 */
function detectSimplePattern(ast: UplcTerm): ValidatorInfo {
  const utilityBindings: Record<string, string> = {};
  const scriptParams: string[] = [];  // Pre-applied script parameters (actual data values)
  const validatorParams: string[] = [];  // Runtime validator parameters (datum, redeemer, ctx)
  
  // Step 1: Unwrap outer applications to find the core lambda
  // Collect all applied args and their corresponding lambda params
  let current: UplcTerm = ast;
  const appliedArgs: UplcTerm[] = [];
  
  while (current.tag === 'app') {
    appliedArgs.unshift(current.arg);
    current = current.func;
  }
  
  // Now 'current' should be a lambda (if script is parameterized)
  // 'appliedArgs' contains applied values (builtins for utilities, data for params)
  
  // Match outer lambdas to applied args - distinguish utilities from script params
  const lambdaParamsMatched: string[] = [];
  for (let i = 0; i < appliedArgs.length && current.tag === 'lam'; i++) {
    const param = current.param;
    const arg = appliedArgs[i];
    const utilityName = extractUtilityName(arg);
    
    if (utilityName) {
      // This is a utility binding (builtin or partial app applied to lambda)
      utilityBindings[param] = utilityName;
    } else {
      // This is a script parameter (data value applied to lambda)
      scriptParams.push(param);
    }
    
    lambdaParamsMatched.push(param);
    current = current.body;
    
    // Continue unwrapping if body is also an application
    while (current.tag === 'app') {
      appliedArgs.splice(i + 1, 0, current.arg);  // Insert new args after current position
      current = current.func;
    }
  }
  
  // Step 2: Extract any additional utility bindings from nested patterns
  function extractUtilities(term: UplcTerm): void {
    const innerAppliedArgs: UplcTerm[] = [];
    let inner: UplcTerm = term;

    while (inner.tag === 'app') {
      innerAppliedArgs.unshift(inner.arg);
      inner = inner.func;
    }

    const lambdaParams: string[] = [];
    while (inner.tag === 'lam') {
      lambdaParams.push(inner.param);
      inner = inner.body;
    }

    for (let i = 0; i < Math.min(lambdaParams.length, innerAppliedArgs.length); i++) {
      const param = lambdaParams[i];
      const arg = innerAppliedArgs[i];
      const utilityName = extractUtilityName(arg);

      if (utilityName && !utilityBindings[param]) {
        utilityBindings[param] = utilityName;
      }
    }

    if (inner.tag === 'app') {
      extractUtilities(inner);
    }
  }

  extractUtilities(current);

  // Step 3: Collect validator parameters (non-script, non-utility lambdas)
  function collectParamsAndBody(term: UplcTerm): UplcTerm {
    if (term.tag === 'lam') {
      if (!utilityBindings[term.param] && !scriptParams.includes(term.param)) {
        validatorParams.push(term.param);
      }
      return collectParamsAndBody(term.body);
    } else if (term.tag === 'app') {
      const isUtilityApp = term.arg.tag === 'builtin' ||
                          (term.arg.tag === 'force' && extractBuiltinName(term.arg));

      if (isUtilityApp) {
        return collectParamsAndBody(term.func);
      }

      return term;
    }
    return term;
  }

  const finalBody = collectParamsAndBody(current);
  
  // Combine script params + validator params for full signature
  const allParams = [...scriptParams, ...validatorParams];
  const purpose = inferPurposeFromParams(validatorParams.length > 0 ? validatorParams : allParams, finalBody);

  return {
    type: purpose,
    params: validatorParams.length > 0 ? validatorParams : allParams,
    body: finalBody,
    utilityBindings: Object.keys(utilityBindings).length > 0 ? utilityBindings : undefined
  };
}

/**
 * Infer script purpose from parameter count and body analysis
 */
function inferPurposeFromParams(params: string[], body: UplcTerm): ScriptPurpose {
  // Plutus V3 handlers in Aiken have these signatures:
  // spend: (datum?, redeemer, output_ref, tx) - 4 params (or 3 with inline datum)
  // mint:  (redeemer, policy_id, tx) - 3 params
  // withdraw: (redeemer, credential, tx) - 3 params  
  // publish: (redeemer, certificate, tx) - 3 params
  // vote: (redeemer, voter, governance_action_id, tx) - 4 params
  // propose: (redeemer, proposal_procedure, tx) - 3 params
  
  // Simple validators (not V3-wrapped) often have 3 params: datum, redeemer, ctx
  // V3-wrapped validators extract more params from ScriptContext
  
  // Use naming hints if available
  const paramNames = params.map(p => p.toLowerCase());
  
  // Check for explicit naming hints
  if (paramNames.some(p => p.includes('datum'))) {
    return 'spend';  // Has datum → spend
  }
  if (paramNames.some(p => p.includes('policy') || p === 'pid')) {
    return 'mint';  // Has policy → mint
  }
  if (paramNames.some(p => p.includes('credential') || p.includes('stake'))) {
    return 'withdraw';
  }
  if (paramNames.some(p => p.includes('cert'))) {
    return 'publish';
  }
  if (paramNames.some(p => p.includes('vote') || p.includes('voter'))) {
    return 'vote';
  }
  if (paramNames.some(p => p.includes('proposal'))) {
    return 'propose';
  }
  
  // Fall back to param count heuristics
  if (params.length >= 5) {
    return analyzeBodyForPurpose(body, params);
  }
  
  if (params.length >= 3) {
    // 3-4 params is most commonly spend (datum, redeemer, ctx or output_ref, tx)
    return 'spend';
  }
  
  if (params.length === 2) {
    // 2 params without datum hint → likely mint (redeemer, ctx)
    return 'mint';
  }
  
  return 'unknown';
}

/**
 * Analyze the body to determine script purpose
 * TODO: Look for specific patterns like:
 * - OutputReference access -> spend
 * - PolicyId access -> mint
 * - StakeCredential access -> withdraw
 * - Certificate access -> publish
 * - Voter access -> vote
 * - ProposalProcedure access -> propose
 */
function analyzeBodyForPurpose(body: UplcTerm, params: string[]): ScriptPurpose {
  // For now, just return based on common patterns
  // A full implementation would trace how parameters are used
  
  if (params.length >= 4) {
    return 'spend';  // Most common
  }
  
  return 'mint';
}

/**
 * Get the redeemer parameter name from a validator
 */
export function getRedeemerParam(info: ValidatorInfo): string | undefined {
  // For spend, datum is first, redeemer is second
  // For all others (mint, withdraw, publish, vote, propose), redeemer is first
  if (info.type === 'spend' && info.params.length >= 2) {
    return info.params[1];  // Second param is redeemer for spend
  } else if (info.type !== 'spend' && info.type !== 'unknown' && info.params.length >= 1) {
    return info.params[0];  // First param is redeemer for non-spend
  }
  return undefined;
}

/**
 * Get the script context/transaction parameter name
 */
export function getContextParam(info: ValidatorInfo): string | undefined {
  // Context/tx is always the last param
  if (info.params.length >= 1) {
    return info.params[info.params.length - 1];
  }
  return undefined;
}

/**
 * Get the datum parameter name (spend validators only)
 */
export function getDatumParam(info: ValidatorInfo): string | undefined {
  if (info.type === 'spend' && info.params.length >= 1) {
    return info.params[0];
  }
  return undefined;
}
