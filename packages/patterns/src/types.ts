/**
 * Pattern Recognition Output Types
 */
import type { UplcTerm } from '@uplc/parser';

/**
 * Script purpose (Plutus V3 terminology)
 */
export type ScriptPurpose = 
  | 'spend'           // UTxO spending validator
  | 'mint'            // Minting/burning policy
  | 'withdraw'        // Staking reward withdrawal
  | 'publish'         // Certificate publishing (delegation, registration)
  | 'vote'            // Governance voting (CIP-1694)
  | 'propose'         // Governance proposals (CIP-1694)
  | 'unknown';

/**
 * Overall contract structure analysis
 */
export interface ContractStructure {
  type: ScriptPurpose;
  params: string[];           // Parameter names
  datum: DatumInfo;           // Datum structure (spend validators only)
  redeemer: RedeemerInfo;
  checks: ValidationCheck[];
  rawBody: UplcTerm;
  utilities?: UplcTerm;       // Utility functions from V3 wrapper
  utilityBindings?: Record<string, string>;  // Map param names to builtin names (V3)
}

/**
 * Datum structure analysis (spend validators)
 */
export interface DatumInfo {
  /** Whether datum is used (vs ignored) */
  isUsed: boolean;
  /** Whether datum is optional (V3 inline datums) */
  isOptional: boolean;
  /** Detected fields accessed from datum */
  fields: FieldInfo[];
  /** Inferred type structure */
  inferredType: 'unknown' | 'unit' | 'custom';
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
