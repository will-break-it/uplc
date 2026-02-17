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
  name: string;      // Generated name like param_0 or script_hash_0
  type: string;      // 'bytestring' | 'integer' | 'data'
  value: string;     // Hex string or numeric value
}

export interface ValidatorInfo {
  type: ScriptPurpose;
  params: string[];
  body: UplcTerm;
  bodyWithBindings?: UplcTerm;  // Body including let-binding chain (before param stripping)
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
    const name = hex.length === 56 ? `script_hash_${index}`
               : hex.length === 64 ? `policy_id_${index}`
               : `param_${index}`;
    return { name, type: 'bytestring', value: hex };
  }

  if (type === 'integer' || value?.tag === 'integer') {
    const num = value?.value ?? value;
    return { name: `param_${index}`, type: 'integer', value: num.toString() };
  }

  if (type === 'data' || value?.tag === 'data') {
    // Handle Data-encoded values — may be nested Constr structures
    const innerValue = value?.value || value;
    if (innerValue?.tag === 'bytes' || innerValue?.tag === 'B') {
      const hex = typeof innerValue.value === 'string'
        ? innerValue.value
        : bytesToHex(innerValue.value);
      const name = hex.length === 56 ? `script_hash_${index}`
                 : hex.length === 64 ? `policy_id_${index}`
                 : `param_${index}`;
      return { name, type: 'bytestring', value: hex };
    }
    if (innerValue?.tag === 'int' || innerValue?.tag === 'I') {
      return { name: `param_${index}`, type: 'integer', value: (innerValue.value ?? innerValue).toString() };
    }
    // For complex Data structures (Constr, List, Map), serialize as readable representation
    const dataStr = serializeDataParam(innerValue);
    if (dataStr) {
      return { name: `param_${index}`, type: 'data', value: dataStr };
    }
  }
  
  return null;
}

/**
 * Serialize a Data parameter to a human-readable string
 * e.g., Constr 0 [Constr 0 [B #1510c33e...], I 0] → "builtin.constr_data(0, [builtin.constr_data(0, [#1510c33e...]), 0])"
 */
function serializeDataParam(data: any): string | null {
  if (!data || typeof data !== 'object') return null;
  
  const tag = data.tag;
  
  if (tag === 'constr' || data.fields) {
    const idx = data.index ?? data.constr ?? 0;
    const fields = data.fields || [];
    if (fields.length === 0) return `builtin.constr_data(${idx}, [])`;
    const serializedFields = fields.map((f: any) => serializeDataParam(f) || '?').join(', ');
    return `builtin.constr_data(${idx}, [${serializedFields}])`;
  }
  
  if (tag === 'bytes' || tag === 'B') {
    const raw = data.value;
    const hex = (raw instanceof Uint8Array) ? bytesToHex(raw) : (typeof raw === 'string' ? raw : '');
    return `#"${hex}"`;
  }
  
  if (tag === 'int' || tag === 'I') {
    return (data.value ?? data).toString();
  }
  
  if (tag === 'list' || Array.isArray(data.value)) {
    const items = Array.isArray(data.value) ? data.value : (data.items || data.list || []);
    const serialized = items.map((i: any) => serializeDataParam(i) || '?').join(', ');
    return `[${serialized}]`;
  }
  
  if (tag === 'map') {
    return 'Map(...)';
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
function extractUtilityName(term: UplcTerm, knownUtilities?: Record<string, string>): string | null {
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

    // Only treat as utility if arg is a constant (true partial application).
    // Full applications like unConstrData(j) return a value, not a function.
    if (term.arg.tag === 'con') return builtinName;
    return null;
  }

  // Compound utility: fn(x) { VAR(builtin(x)) } where VAR is a known utility
  // e.g. fn(x) { f(unConstrData(x)) } where f = fstPair → "constr_tag"
  if (term.tag === 'lam' && knownUtilities) {
    const body = term.body;
    if (body.tag === 'app' && body.func.tag === 'var' && body.arg.tag === 'app') {
      const outerVar = body.func.name;
      const outerBuiltin = knownUtilities[outerVar];
      const innerBuiltin = extractBuiltinName(body.arg.func);
      const argIsParam = body.arg.arg.tag === 'var' && body.arg.arg.name === term.param;
      if (outerBuiltin && innerBuiltin && argIsParam) {
        // fn(x) { fstPair(unConstrData(x)) } → constr_tag
        if (outerBuiltin === 'fstPair' && innerBuiltin === 'unConstrData') return 'constr_tag';
        // fn(x) { sndPair(unConstrData(x)) } → constr_fields
        if (outerBuiltin === 'sndPair' && innerBuiltin === 'unConstrData') return 'constr_fields';
        // Generic composition: outer(inner(x))
        return `${outerBuiltin}_${innerBuiltin}`;
      }
    }
  }

  return null;
}

/**
 * Find the first lambda chain with at least minParams in a term
 * Searches top-down to find validator params (not helper functions)
 */
function findFirstSignificantLambdaChain(
  term: UplcTerm, 
  minParams: number
): { params: string[]; body: UplcTerm } {
  let found: { params: string[]; body: UplcTerm } | null = null;
  
  function search(t: UplcTerm): boolean {
    // Check if this is a significant lambda chain
    if (t.tag === 'lam') {
      const params: string[] = [];
      let current: UplcTerm = t;
      while (current.tag === 'lam') {
        params.push(current.param);
        current = current.body;
      }
      
      // If this chain meets the minimum, we found it
      if (params.length >= minParams) {
        found = { params, body: current };
        return true;  // Stop searching
      }
      
      // Continue searching in the body
      return search(current);
    } else if (t.tag === 'app') {
      // Search func first (top-down), then arg
      return search(t.func) || search(t.arg);
    } else if (t.tag === 'force') {
      return search(t.term);
    } else if (t.tag === 'delay') {
      return search(t.term);
    } else if (t.tag === 'case') {
      if (search(t.scrutinee)) return true;
      for (const b of t.branches) {
        if (search(b)) return true;
      }
    } else if (t.tag === 'constr') {
      for (const a of t.args || []) {
        if (search(a)) return true;
      }
    }
    return false;
  }
  
  search(term);
  return found || { params: [], body: term };
}

/**
 * Simple pattern: Detect Plutus-style utility binding pattern
 * Handles:
 * 1. Parameterized scripts: [[[lam a [lam b ...]] param1] param2] param3]
 * 2. Nested utility bindings: ((lam i_0 ((lam i_1 BODY) util1)) util0)
 * 3. Mixed utility/script params: [[[lam a [lam b ...]] builtin1] builtin2] data_param]
 * 4. Deep nesting: utilities wrapping the actual validator params
 */
function detectSimplePattern(ast: UplcTerm): ValidatorInfo {
  const utilityBindings: Record<string, string> = {};
  const scriptParams: string[] = [];  // Pre-applied script parameters (actual data values)
  let validatorParams: string[] = [];  // Runtime validator parameters (datum, redeemer, ctx)
  
  // Save the full inner body before any extraction (contains all let-bindings with constants)
  // This is after script parameter unwrapping (done by caller) but before utility/param stripping
  const fullInnerBody = ast;
  
  // Step 1: Unwrap outer applications to find the core lambda
  let current: UplcTerm = ast;
  const appliedArgs: UplcTerm[] = [];
  
  while (current.tag === 'app') {
    appliedArgs.unshift(current.arg);
    current = current.func;
  }
  
  // Internal bindings: non-utility lambdas (Z-combinators, helpers) that must be
  // preserved as let-bindings in the body rather than stripped as script params
  const internalBindings: Array<{ param: string; arg: UplcTerm }> = [];

  // Match outer lambdas to applied args - distinguish utilities from script params
  for (let i = 0; i < appliedArgs.length && current.tag === 'lam'; i++) {
    const param = current.param;
    const arg = appliedArgs[i];
    const utilityName = extractUtilityName(arg, utilityBindings);

    if (utilityName) {
      utilityBindings[param] = utilityName;
    } else if (arg.tag === 'lam') {
      // Lambda args are internal helpers (Z-combinators, etc.), not script params.
      // Preserve them as let-bindings in the body.
      internalBindings.push({ param, arg });
    } else {
      scriptParams.push(param);
    }
    
    current = current.body;
    
    // Continue unwrapping if body is also an application
    while (current.tag === 'app') {
      appliedArgs.splice(i + 1, 0, current.arg);
      current = current.func;
    }
  }

  // Save body before param extraction — contains let-bindings with constants
  const bodyBeforeParams = current;
  
  // Step 2: Try to find validator params at current level
  // First, check immediate lambda chain (after utility unwrapping)
  if (current.tag === 'lam') {
    let temp: UplcTerm = current;
    while (temp.tag === 'lam') {
      if (!utilityBindings[temp.param] && !scriptParams.includes(temp.param)) {
        validatorParams.push(temp.param);
      }
      temp = temp.body;
    }
    if (validatorParams.length >= 2) {
      current = temp;
    } else {
      validatorParams = [];  // Reset if not enough params
    }
  }
  
  // If no immediate params found, search for the first lambda chain of 3+ params
  // (This handles deeply wrapped validators like Minswap Pool)
  if (validatorParams.length < 2) {
    const chain = findFirstSignificantLambdaChain(current, 3);
    if (chain.params.length >= 2) {
      validatorParams = chain.params;
      current = chain.body;
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

  let finalBody = collectParamsAndBody(current);

  // Re-wrap internal bindings (Z-combinators, helpers) back into the body so they
  // become let-bindings in the generated code that the codegen can hoist
  for (let i = internalBindings.length - 1; i >= 0; i--) {
    const { param, arg } = internalBindings[i];
    finalBody = { tag: 'app', func: { tag: 'lam', param, body: finalBody }, arg } as UplcTerm;
  }
  
  // Combine script params + validator params for full signature
  const allParams = [...scriptParams, ...validatorParams];
  const purpose = inferPurposeFromParams(validatorParams.length > 0 ? validatorParams : allParams, finalBody);

  return {
    type: purpose,
    params: validatorParams.length > 0 ? validatorParams : allParams,
    body: finalBody,
    bodyWithBindings: countNonTrivialConstants(fullInnerBody) > countNonTrivialConstants(finalBody) ? fullInnerBody : undefined,
    utilityBindings: Object.keys(utilityBindings).length > 0 ? utilityBindings : undefined
  };
}

/**
 * Count non-trivial constants (integers > 1, bytestrings, data) in an AST
 */
function countNonTrivialConstants(term: UplcTerm): number {
  if (!term) return 0;
  let count = 0;
  function walk(t: UplcTerm) {
    if (!t) return;
    if (t.tag === 'con') {
      const v = (t as any).value;
      if (v?.tag === 'integer') {
        const n = Number(v.value);
        if (n !== 0 && n !== 1) count++;
      } else if (v?.tag === 'bytestring' || v?.tag === 'string' || v?.tag === 'data') {
        count++;
      }
      return;
    }
    if (t.tag === 'app') { walk((t as any).func); walk((t as any).arg); }
    if (t.tag === 'lam') walk((t as any).body);
    if (t.tag === 'force' || t.tag === 'delay') walk((t as any).term);
    if (t.tag === 'case') { walk((t as any).scrutinee); (t as any).branches?.forEach(walk); }
    if (t.tag === 'constr') { (t as any).args?.forEach(walk); }
  }
  walk(term);
  return count;
}

/**
 * Infer script purpose from parameter count and body analysis
 */
function inferPurposeFromParams(params: string[], body: UplcTerm): ScriptPurpose {
  // Use naming hints if available (works when params have meaningful names)
  const paramNames = params.map(p => p.toLowerCase());
  
  if (paramNames.some(p => p.includes('datum'))) {
    return 'spend';
  }
  if (paramNames.some(p => p.includes('policy') || p === 'pid')) {
    return 'mint';
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
  
  // Analyze body usage patterns (works even with a, b, c names)
  return analyzeBodyForPurpose(body, params);
}

/**
 * Analyze the body to determine script purpose based on how parameters are used
 */
function analyzeBodyForPurpose(body: UplcTerm, params: string[]): ScriptPurpose {
  if (params.length === 0) return 'unknown';
  
  // Check first param (datum in spend validators)
  const firstParamUsage = analyzeParamUsage(body, params[0]);
  
  // Check second param if exists (redeemer in spend, or first user param in mint)
  const secondParamUsage = params.length >= 2 ? analyzeParamUsage(body, params[1]) : null;
  
  // Strong spend indicator: first param has structured data access
  if (firstParamUsage.hasUnConstrData && 
      (firstParamUsage.hasFieldAccess || firstParamUsage.hasSndPair)) {
    return 'spend';
  }
  
  // If first param is unused/simple but second has complex access → likely spend with unit datum
  if (secondParamUsage && 
      secondParamUsage.hasUnConstrData && 
      secondParamUsage.hasFieldAccess) {
    return 'spend';
  }
  
  // Param count heuristics as fallback
  if (params.length >= 4) {
    return 'spend';  // 4+ params usually spend (datum, redeemer, out_ref, tx)
  }
  
  if (params.length === 3) {
    // 3 params: could be spend (datum, redeemer, ctx) or mint (redeemer, policy, ctx)
    // If first param has any data extraction, lean toward spend
    if (firstParamUsage.dataExtractionCount > 0) {
      return 'spend';
    }
    // Default 3-param to spend (most common)
    return 'spend';
  }
  
  if (params.length === 2) {
    // 2 params: typically mint (redeemer, ctx)
    return 'mint';
  }
  
  if (params.length === 1) {
    // 1 param: minting policy with simple redeemer
    return 'mint';
  }
  
  return 'unknown';
}

interface ParamUsageInfo {
  hasUnConstrData: boolean;
  hasFieldAccess: boolean;
  hasSndPair: boolean;
  dataExtractionCount: number;
}

/**
 * Analyze how a parameter is used in the body
 */
function analyzeParamUsage(body: UplcTerm, param: string): ParamUsageInfo {
  const usage: ParamUsageInfo = {
    hasUnConstrData: false,
    hasFieldAccess: false,
    hasSndPair: false,
    dataExtractionCount: 0
  };
  
  traverseForUsage(body, param, usage);
  return usage;
}

/**
 * Traverse AST to find parameter usage patterns
 */
function traverseForUsage(term: UplcTerm, param: string, usage: ParamUsageInfo): void {
  if (!term) return;
  
  switch (term.tag) {
    case 'app': {
      // Check if this is a builtin application on our param
      let funcTerm = term.func;
      while (funcTerm.tag === 'app' || funcTerm.tag === 'force') {
        if (funcTerm.tag === 'force') funcTerm = funcTerm.term;
        else funcTerm = funcTerm.func;
      }
      
      if (funcTerm.tag === 'builtin') {
        const builtin = funcTerm.name;
        
        // Check if arg references our param (directly or indirectly)
        if (termReferencesParam(term.arg, param) || termReferencesParam(term, param)) {
          switch (builtin) {
            case 'unConstrData':
              usage.hasUnConstrData = true;
              usage.dataExtractionCount++;
              break;
            case 'sndPair':
              usage.hasSndPair = true;
              break;
            case 'headList':
            case 'tailList':
              usage.hasFieldAccess = true;
              break;
            case 'unIData':
            case 'unBData':
            case 'unListData':
            case 'unMapData':
              usage.dataExtractionCount++;
              break;
          }
        }
      }
      
      traverseForUsage(term.func, param, usage);
      traverseForUsage(term.arg, param, usage);
      break;
    }
    case 'lam':
      if (term.param !== param) { // Don't cross shadowing
        traverseForUsage(term.body, param, usage);
      }
      break;
    case 'force':
      traverseForUsage(term.term, param, usage);
      break;
    case 'delay':
      traverseForUsage(term.term, param, usage);
      break;
    case 'case':
      traverseForUsage(term.scrutinee, param, usage);
      term.branches.forEach(b => traverseForUsage(b, param, usage));
      break;
    case 'constr':
      term.args?.forEach(a => traverseForUsage(a, param, usage));
      break;
  }
}

/**
 * Check if a term references a parameter (direct or through applications)
 */
function termReferencesParam(term: UplcTerm, param: string): boolean {
  if (!term) return false;
  
  switch (term.tag) {
    case 'var':
      return term.name === param;
    case 'app':
      return termReferencesParam(term.func, param) || termReferencesParam(term.arg, param);
    case 'force':
      return termReferencesParam(term.term, param);
    case 'lam':
      return term.param !== param && termReferencesParam(term.body, param);
    default:
      return false;
  }
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
