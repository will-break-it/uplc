/**
 * Data Flow Analysis
 *
 * Tracks how datum/redeemer fields flow through validation logic.
 * Enables better type inference and meaningful variable naming.
 */

import type { UplcTerm } from '@uplc/parser';
import { flattenApp, getBuiltinName, referencesVar } from './traversal.js';

export interface DataFlowNode {
  id: string;
  kind: 'source' | 'transform' | 'sink';
  term: UplcTerm;
  description: string;
}

export interface DataFlowEdge {
  from: string;
  to: string;
  transform?: string;
}

export interface DataFlowGraph {
  nodes: DataFlowNode[];
  edges: DataFlowEdge[];
}

export interface VariableFlow {
  variable: string;
  source: 'datum' | 'redeemer' | 'context' | 'local';
  field?: string;
  transforms: string[];
  usages: VariableUsage[];
  inferredType?: string;
}

export interface VariableUsage {
  kind: 'comparison' | 'crypto' | 'arithmetic' | 'list_op' | 'data_extract' | 'other';
  builtin?: string;
  location: UplcTerm;
  inferredType?: string;
}

/**
 * Analyze data flow in a validator body
 */
export function analyzeDataFlow(
  body: UplcTerm,
  datumParam?: string,
  redeemerParam?: string,
  contextParam?: string
): Map<string, VariableFlow> {
  const flows = new Map<string, VariableFlow>();

  // Track datum flows
  if (datumParam) {
    trackVariableFlow(body, datumParam, 'datum', flows);
  }

  // Track redeemer flows
  if (redeemerParam) {
    trackVariableFlow(body, redeemerParam, 'redeemer', flows);
  }

  // Track context flows
  if (contextParam) {
    trackVariableFlow(body, contextParam, 'context', flows);
  }

  return flows;
}

/**
 * Track how a variable flows through the AST
 */
function trackVariableFlow(
  term: UplcTerm,
  varName: string,
  source: VariableFlow['source'],
  flows: Map<string, VariableFlow>
): void {
  const flow: VariableFlow = {
    variable: varName,
    source,
    transforms: [],
    usages: []
  };

  // Find all usages of this variable
  findUsages(term, varName, flow);

  flows.set(varName, flow);
}

/**
 * Find all usages of a variable in a term
 */
function findUsages(term: UplcTerm, varName: string, flow: VariableFlow): void {
  switch (term.tag) {
    case 'app': {
      // Check if this is a builtin application using our variable
      const parts = flattenApp(term);
      const builtinName = getBuiltinName(parts[0]);

      if (builtinName && parts.slice(1).some(arg => referencesVar(arg, varName))) {
        const usage = classifyUsage(builtinName, term);
        flow.usages.push(usage);

        // Track transform
        if (isTransformBuiltin(builtinName)) {
          flow.transforms.push(builtinName);
        }
      }

      // Recurse
      findUsages(term.func, varName, flow);
      findUsages(term.arg, varName, flow);
      break;
    }

    case 'lam':
      if (term.param !== varName) { // Don't shadow
        findUsages(term.body, varName, flow);
      }
      break;

    case 'case':
      findUsages(term.scrutinee, varName, flow);
      term.branches.forEach(branch => findUsages(branch, varName, flow));
      break;

    case 'constr':
      term.args?.forEach(arg => findUsages(arg, varName, flow));
      break;

    case 'force':
      findUsages(term.term, varName, flow);
      break;

    case 'delay':
      findUsages(term.term, varName, flow);
      break;
  }
}

/**
 * Classify variable usage based on builtin
 */
function classifyUsage(builtin: string, term: UplcTerm): VariableUsage {
  const cryptoBuiltins = [
    'verifyEd25519Signature',
    'verifyEcdsaSecp256k1Signature',
    'verifySchnorrSecp256k1Signature',
    'sha2_256',
    'sha3_256',
    'blake2b_256',
    'blake2b_224',
    'keccak_256'
  ];

  const comparisonBuiltins = [
    'equalsInteger',
    'lessThanInteger',
    'lessThanEqualsInteger',
    'equalsByteString',
    'equalsData'
  ];

  const arithmeticBuiltins = [
    'addInteger',
    'subtractInteger',
    'multiplyInteger',
    'divideInteger',
    'quotientInteger',
    'remainderInteger',
    'modInteger'
  ];

  const listBuiltins = [
    'headList',
    'tailList',
    'nullList',
    'mkCons',
    'chooseList'
  ];

  const dataExtractionBuiltins = [
    'unConstrData',
    'unListData',
    'unMapData',
    'unIData',
    'unBData',
    'fstPair',
    'sndPair'
  ];

  let kind: VariableUsage['kind'] = 'other';
  let inferredType: string | undefined;

  if (cryptoBuiltins.includes(builtin)) {
    kind = 'crypto';
    if (builtin.includes('verify')) {
      inferredType = 'ByteArray'; // Signature or public key
    }
  } else if (comparisonBuiltins.includes(builtin)) {
    kind = 'comparison';
    if (builtin.includes('Integer')) {
      inferredType = 'Int';
    } else if (builtin.includes('ByteString')) {
      inferredType = 'ByteArray';
    }
  } else if (arithmeticBuiltins.includes(builtin)) {
    kind = 'arithmetic';
    inferredType = 'Int';
  } else if (listBuiltins.includes(builtin)) {
    kind = 'list_op';
    inferredType = 'List';
  } else if (dataExtractionBuiltins.includes(builtin)) {
    kind = 'data_extract';
  }

  return {
    kind,
    builtin,
    location: term,
    inferredType
  };
}

/**
 * Check if a builtin transforms data (vs just checking it)
 */
function isTransformBuiltin(builtin: string): boolean {
  const transformBuiltins = [
    'unConstrData',
    'unListData',
    'unMapData',
    'unIData',
    'unBData',
    'fstPair',
    'sndPair',
    'headList',
    'tailList',
    'sha2_256',
    'sha3_256',
    'blake2b_256',
    'serialiseData',
    'decodeUtf8',
    'encodeUtf8'
  ];

  return transformBuiltins.includes(builtin);
}

/**
 * Infer type from usage pattern
 */
export function inferTypeFromUsage(flow: VariableFlow): string {
  if (flow.usages.length === 0) return 'Data';

  // Count usage kinds
  const usageKinds = new Map<string, number>();
  for (const usage of flow.usages) {
    if (usage.inferredType) {
      usageKinds.set(usage.inferredType, (usageKinds.get(usage.inferredType) || 0) + 1);
    }
  }

  // Return most common type
  let maxCount = 0;
  let maxType = 'Data';
  for (const [type, count] of usageKinds) {
    if (count > maxCount) {
      maxCount = count;
      maxType = type;
    }
  }

  return maxType;
}

/**
 * Generate semantic variable name from flow
 */
export function inferVariableName(flow: VariableFlow): string {
  // Check transforms first
  if (flow.transforms.includes('unIData')) return 'amount';
  if (flow.transforms.includes('unBData')) {
    if (flow.usages.some(u => u.kind === 'crypto')) {
      return 'signature';
    }
    return 'token_name';
  }

  // Check usage patterns
  const cryptoUsage = flow.usages.find(u => u.kind === 'crypto');
  if (cryptoUsage) {
    if (cryptoUsage.builtin?.includes('verify')) {
      return 'signer';
    }
    return 'hash';
  }

  const comparisonUsage = flow.usages.find(u => u.kind === 'comparison');
  if (comparisonUsage) {
    if (flow.inferredType === 'Int') {
      return 'deadline';
    }
    return 'owner';
  }

  const arithmeticUsage = flow.usages.find(u => u.kind === 'arithmetic');
  if (arithmeticUsage) {
    return 'amount';
  }

  // Default based on source
  if (flow.source === 'datum') return 'datum_field';
  if (flow.source === 'redeemer') return 'redeemer_field';
  return 'value';
}
