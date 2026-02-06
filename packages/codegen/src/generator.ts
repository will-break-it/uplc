/**
 * Code Generator - ContractStructure → GeneratedCode
 */

import type { ContractStructure, RedeemerVariant, ValidationCheck } from '@uplc/patterns';
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
  
  // Determine handler kind based on contract type
  const handlerKind = structure.type === 'minting_policy' ? 'mint' : 'spend';
  
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
 * Generate handler parameters
 */
function generateParams(structure: ContractStructure, opts: GeneratorOptions): ParameterInfo[] {
  const params = structure.params;
  
  if (structure.type === 'minting_policy') {
    // mint(redeemer, policy_id, tx)
    return [
      { name: params[0] || 'redeemer', type: 'Data' },
      { name: params[1] || 'policy_id', type: 'PolicyId' },
      { name: params[2] || 'tx', type: 'Transaction' }
    ];
  }
  
  // spend(datum, redeemer, own_ref, tx)
  return [
    { name: params[0] || 'datum', type: 'Option<Data>', isOptional: true },
    { name: params[1] || 'redeemer', type: structure.redeemer.variants.length > 1 ? 'Action' : 'Data' },
    { name: params[2] || 'own_ref', type: 'OutputReference' },
    { name: params[3] || 'tx', type: 'Transaction' }
  ];
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
