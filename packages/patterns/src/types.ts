import type { UplcTerm } from '@uplc/parser';

/**
 * Overall contract structure extracted from UPLC
 */
export interface ContractStructure {
  type: 'validator' | 'minting_policy' | 'unknown';
  params: string[];           // Parameter names (datum, redeemer, ctx)
  redeemer: RedeemerInfo;
  checks: ValidationCheck[];
  body: UplcTerm;
}

/**
 * Information about the redeemer type
 */
export interface RedeemerInfo {
  variants: RedeemerVariant[];
  matchPattern: 'constructor' | 'integer' | 'unknown';
}

/**
 * A single redeemer variant (constructor case)
 */
export interface RedeemerVariant {
  index: number;              // Constructor index (0, 1, 2...)
  name: string;               // Generated name: "Variant0", "Variant1"
  fields: FieldInfo[];        // Extracted field accesses
  body: UplcTerm;             // Branch body
}

/**
 * Field access information
 */
export interface FieldInfo {
  index: number;              // Field index in constructor
  accessPath: string;         // e.g., "headList(sndPair(...))"
  inferredType: 'integer' | 'bytestring' | 'bool' | 'list' | 'data' | 'unknown';
}

/**
 * A validation check found in the contract
 */
export interface ValidationCheck {
  type: 'signature' | 'deadline' | 'value' | 'equality' | 'comparison' | 'builtin_call' | 'unknown';
  builtin: string;            // The builtin function used
  description: string;        // Human-readable description
  node: UplcTerm;             // The AST node
}
