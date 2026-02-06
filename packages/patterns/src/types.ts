/**
 * Pattern Recognition Output Types
 */
import type { UplcTerm } from '@uplc/parser';

/**
 * Overall contract structure analysis
 */
export interface ContractStructure {
  type: 'validator' | 'minting_policy' | 'unknown';
  params: string[];           // Parameter names (datum, redeemer, ctx)
  redeemer: RedeemerInfo;
  checks: ValidationCheck[];
  rawBody: UplcTerm;
}

/**
 * Redeemer structure analysis
 */
export interface RedeemerInfo {
  variants: RedeemerVariant[];
  matchPattern: 'constructor' | 'integer' | 'unknown';
}

/**
 * A single redeemer variant (branch in the match)
 */
export interface RedeemerVariant {
  index: number;              // Constructor index (0, 1, 2...)
  name: string;               // Generated name: "variant_0", "variant_1"
  fields: FieldInfo[];        // Extracted fields
  body: UplcTerm;             // Branch body
}

/**
 * Information about an extracted field
 */
export interface FieldInfo {
  index: number;
  accessPattern: string;      // "headList", "headList(tailList(...))"
  inferredType: string;       // "integer", "bytestring", "unknown"
}

/**
 * A validation check found in the contract
 */
export interface ValidationCheck {
  type: 'signature' | 'deadline' | 'value' | 'equality' | 'comparison' | 'unknown';
  builtin: string;            // The builtin used
  description: string;        // Human-readable description
  location: UplcTerm;         // The AST node
}
