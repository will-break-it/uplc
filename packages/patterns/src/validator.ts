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

export interface ValidatorInfo {
  type: ScriptPurpose;
  params: string[];
  body: UplcTerm;
  utilities?: UplcTerm;  // The constr with utility functions if detected
}

/**
 * Detect the validator entry point structure
 */
export function detectValidator(ast: UplcTerm): ValidatorInfo {
  // First try Plutus V3 pattern detection
  const v3Result = detectV3Pattern(ast);
  if (v3Result) return v3Result;
  
  // Fall back to simple lambda counting
  return detectSimplePattern(ast);
}

/**
 * Detect Plutus V3 (Aiken-compiled) pattern:
 * (lam outer (case (constr 0 utils...) (lam a (lam b ... BODY))))
 */
function detectV3Pattern(ast: UplcTerm): ValidatorInfo | null {
  // Must start with a lambda
  if (ast.tag !== 'lam') return null;
  
  const outerParam = ast.param;
  const caseExpr = ast.body;
  
  // Body must be a case expression
  if (caseExpr.tag !== 'case') return null;
  
  // Scrutinee should be a constr (utility functions)
  const scrutinee = caseExpr.scrutinee;
  if (scrutinee.tag !== 'constr') return null;
  
  // Should have at least one branch (the actual validator)
  if (caseExpr.branches.length < 1) return null;
  
  const validatorBranch = caseExpr.branches[0];
  
  // Extract params from the branch
  const params: string[] = [];
  let current: UplcTerm = validatorBranch;
  
  while (current.tag === 'lam') {
    params.push(current.param);
    current = current.body;
  }
  
  // Detect purpose based on parameter count
  // Plutus V3 uses ScriptContext which has the purpose embedded
  const purpose = inferPurposeFromParams(params, current);
  
  return {
    type: purpose,
    params,
    body: current,
    utilities: scrutinee
  };
}

/**
 * Simple pattern: just count lambdas
 */
function detectSimplePattern(ast: UplcTerm): ValidatorInfo {
  const params: string[] = [];
  let current: UplcTerm = ast;
  
  // Unwrap nested lambdas
  while (current.tag === 'lam') {
    params.push(current.param);
    current = current.body;
  }
  
  const purpose = inferPurposeFromParams(params, current);
  
  return {
    type: purpose,
    params,
    body: current
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
