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

const DEFAULT_OPTIONS: GeneratorOptions = {
  comments: true,
  namingStyle: 'generic',
  includeTypes: true,
  indent: '  '
};

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
  
  const types: TypeDefinition[] = [];
  const imports: string[] = [];
  
  // Generate redeemer type if we have variants
  if (structure.redeemer.variants.length > 1) {
    types.push(generateRedeemerType(structure.redeemer.variants, opts));
  }
  
  // Determine handler kind based on script purpose
  const handlerKind = purposeToHandlerKind(structure.type);
  
  // Generate handler body
  const body = generateHandlerBody(structure, opts);
  
  // Build handler
  const handler: HandlerBlock = {
    kind: handlerKind,
    params: generateParams(structure, opts),
    body
  };
  
  // Build validator
  const validator: ValidatorBlock = {
    name: 'decompiled_validator',
    params: [], // No validator-level params detected yet
    handlers: [handler]
  };
  
  return { validator, types, imports };
}

/**
 * Generate redeemer type definition
 */
function generateRedeemerType(variants: RedeemerVariant[], opts: GeneratorOptions): TypeDefinition {
  return {
    name: 'Action',
    kind: 'enum',
    variants: variants.map((v, i) => ({
      name: opts.namingStyle === 'descriptive' 
        ? `Action${i}` 
        : `Variant${i}`,
      fields: v.fields.map((f, j) => ({
        name: `field_${j}`,
        type: f.inferredType
      }))
    }))
  };
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
  const redeemerType = structure.redeemer.variants.length > 1 ? 'Action' : 'Data';
  
  switch (structure.type) {
    case 'spend':
      return [
        { name: params[0] || 'datum', type: 'Option<Data>', isOptional: true },
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

/**
 * Generate the handler body
 */
function generateHandlerBody(structure: ContractStructure, opts: GeneratorOptions): CodeBlock {
  const { redeemer, checks } = structure;
  
  // If we have multiple redeemer variants, generate a when expression
  if (redeemer.variants.length > 1) {
    return generateWhenBlock(redeemer.variants, opts);
  }
  
  // If we have checks, generate condition chain
  if (checks.length > 0) {
    return generateChecksBlock(checks, opts);
  }
  
  // Simple validator - just return True
  return {
    kind: 'expression',
    content: 'True'
  };
}

/**
 * Generate a when expression for redeemer variants
 */
function generateWhenBlock(variants: RedeemerVariant[], opts: GeneratorOptions): CodeBlock {
  return {
    kind: 'when',
    content: 'redeemer',
    branches: variants.map((v, i) => ({
      pattern: opts.namingStyle === 'descriptive' 
        ? `Action${i}` 
        : `Variant${i}`,
      body: {
        kind: 'expression',
        content: '...' // TODO: Analyze variant body
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
