/**
 * Purpose Inference
 * 
 * Infers script purpose (spend/mint/withdraw/etc) by analyzing
 * how parameters are consumed in the validator body.
 * 
 * Key patterns:
 * - spend: First param (datum) accessed via unConstrData + field extraction
 * - mint: Context param accessed for minting info (policy ID, tokens)
 * - withdraw: Context param accessed for staking info
 */

import type { UplcTerm } from '@uplc/parser';
import type { ScriptPurpose } from './types.js';
import { flattenApp, getBuiltinName, referencesVar, findAll } from './traversal.js';

interface ParamUsage {
  hasUnConstrData: boolean;
  hasFieldAccess: boolean;  // headList/tailList chains
  hasFstPair: boolean;      // constructor index access
  hasSndPair: boolean;      // constructor fields access
  comparisonCount: number;
  dataExtractionCount: number;
  builtinsUsed: string[];
}

/**
 * Infer script purpose by analyzing parameter usage patterns
 */
export function inferPurpose(
  body: UplcTerm,
  params: string[]
): ScriptPurpose {
  if (params.length === 0) return 'unknown';
  
  // Analyze each parameter's usage
  const usages = params.map(param => analyzeParamUsage(body, param));
  
  // Detect purpose based on usage patterns
  return inferFromUsages(usages, params);
}

/**
 * Analyze how a parameter is used in the body
 */
function analyzeParamUsage(body: UplcTerm, param: string): ParamUsage {
  const usage: ParamUsage = {
    hasUnConstrData: false,
    hasFieldAccess: false,
    hasFstPair: false,
    hasSndPair: false,
    comparisonCount: 0,
    dataExtractionCount: 0,
    builtinsUsed: []
  };
  
  // Find all applications that reference this param
  const apps = findAll(body, t => {
    if (t.tag !== 'app') return false;
    return referencesVar(t, param);
  });
  
  for (const app of apps) {
    if (app.tag !== 'app') continue;
    
    const parts = flattenApp(app);
    const builtin = getBuiltinName(parts[0]);
    
    if (builtin) {
      if (!usage.builtinsUsed.includes(builtin)) {
        usage.builtinsUsed.push(builtin);
      }
      
      // Check builtin type
      switch (builtin) {
        case 'unConstrData':
          usage.hasUnConstrData = true;
          usage.dataExtractionCount++;
          break;
        case 'fstPair':
          usage.hasFstPair = true;
          break;
        case 'sndPair':
          usage.hasSndPair = true;
          break;
        case 'headList':
        case 'tailList':
          usage.hasFieldAccess = true;
          break;
        case 'equalsInteger':
        case 'equalsByteString':
        case 'equalsData':
        case 'lessThanInteger':
        case 'lessThanEqualsInteger':
          usage.comparisonCount++;
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
  
  return usage;
}

/**
 * Infer purpose from parameter usage patterns
 */
function inferFromUsages(usages: ParamUsage[], params: string[]): ScriptPurpose {
  // No params or single param usually means minting policy
  if (params.length <= 1) {
    return 'mint';
  }
  
  // 2 params: typically (redeemer, ctx) for mint/withdraw/publish
  if (params.length === 2) {
    const [param1Usage, param2Usage] = usages;
    
    // If first param has structured data access (unConstrData), could be redeemer
    // Look at context param (param2) to determine purpose
    
    // TODO: Analyze context access patterns to distinguish mint/withdraw/publish
    // For now, default to mint for 2-param scripts
    return 'mint';
  }
  
  // 3+ params: typically spend validator
  if (params.length >= 3) {
    const [datumUsage, redeemerUsage, ...contextUsages] = usages;
    
    // Strong indicator of spend: first param (datum) has unConstrData + field access
    if (datumUsage.hasUnConstrData && (datumUsage.hasFieldAccess || datumUsage.hasSndPair)) {
      return 'spend';
    }
    
    // If datum is accessed at all (even just compared), likely spend
    if (datumUsage.dataExtractionCount > 0 || datumUsage.comparisonCount > 0) {
      return 'spend';
    }
    
    // Check if datum is ignored (unused) - could still be spend with unit datum
    const datumIsIgnored = datumUsage.builtinsUsed.length === 0 && 
                          datumUsage.comparisonCount === 0;
    
    // If redeemer has complex usage, likely spend
    if (redeemerUsage.hasUnConstrData && redeemerUsage.hasFieldAccess) {
      return 'spend';
    }
    
    // 3-param with ignored datum could be V3 spend or other
    if (datumIsIgnored) {
      // Check context for minting patterns
      // TODO: More sophisticated analysis
      return 'spend';  // Default for 3-param
    }
    
    return 'spend';
  }
  
  // 4+ params: Plutus V3 patterns
  if (params.length >= 4) {
    // V3 spend: (datum?, redeemer, output_ref, tx)
    // V3 vote: (redeemer, voter, governance_action_id, tx)
    
    // For now, assume spend for 4-param
    return 'spend';
  }
  
  return 'unknown';
}

/**
 * Detect if body accesses minting-specific context fields
 * Pattern: accessing tx.mint or checking policy IDs
 */
export function hasMintingPatterns(body: UplcTerm, contextParam: string): boolean {
  if (!contextParam) return false;
  
  // Look for patterns that access minting-related fields
  // In Plutus, mint info is accessed from ScriptContext
  // Common pattern: checking if a policy ID is being minted
  
  const apps = findAll(body, t => {
    if (t.tag !== 'app') return false;
    const parts = flattenApp(t);
    const builtin = getBuiltinName(parts[0]);
    
    // Look for unMapData on context (accessing mint field)
    if (builtin === 'unMapData' && parts.length >= 2) {
      return referencesVar(parts[1], contextParam);
    }
    
    return false;
  });
  
  return apps.length > 0;
}

/**
 * Detect if body accesses staking-specific context fields
 */
export function hasStakingPatterns(body: UplcTerm, contextParam: string): boolean {
  // TODO: Implement staking pattern detection
  return false;
}

/**
 * Count how many params are "meaningfully used" (not just passed through)
 */
export function countMeaningfulParams(body: UplcTerm, params: string[]): number {
  let count = 0;
  
  for (const param of params) {
    const usage = analyzeParamUsage(body, param);
    
    // Param is meaningful if it's extracted/compared/transformed
    if (usage.dataExtractionCount > 0 || 
        usage.comparisonCount > 0 || 
        usage.hasUnConstrData ||
        usage.hasFieldAccess) {
      count++;
    }
  }
  
  return count;
}
