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
 * A script parameter (hardcoded constant passed at script level)
 */
export interface ScriptParameter {
  name: string;      // Generated name like PARAM_0 or SCRIPT_HASH
  type: string;      // 'bytestring' | 'integer' | 'data'
  value: string;     // Hex string or numeric value
}

/**
 * Overall contract structure analysis
 *
 * This represents the analyzed structure of a Plutus validator.
 * All fields are used by the codegen package to generate Aiken code.
 */
export interface ContractStructure {
  type: ScriptPurpose;
  params: string[];           // Parameter names - used for validator signature
  datum: DatumInfo;           // Datum structure - used for type generation
  redeemer: RedeemerInfo;     // Redeemer structure - used for type generation
  checks: ValidationCheck[];  // Validation checks - metadata for analysis
  rawBody: UplcTerm;          // Innermost validator body - after stripping params
  bodyWithBindings?: UplcTerm; // Body including let-binding chain (before param stripping)
  fullAst: UplcTerm;          // Full AST including all let-bindings - for BindingEnvironment
  utilities?: UplcTerm;       // Utility functions from V3 wrapper
  utilityBindings?: Record<string, string>;  // Map param names to builtin names (V3)
  scriptParams?: ScriptParameter[];  // Top-level parameterized constants
}

/**
 * Datum structure analysis (spend validators)
 *
 * Used by codegen to:
 * - Decide whether to generate a Datum type (isUsed + fields.length > 0)
 * - Handle optional datum parameters (isOptional for V3 inline datums)
 * - Generate field accessors in validator body
 */
export interface DatumInfo {
  /** Whether datum is used (vs ignored) - affects type generation */
  isUsed: boolean;
  /** Whether datum is optional (V3 inline datums) - affects parameter signature */
  isOptional: boolean;
  /** Detected fields accessed from datum - used for type generation */
  fields: FieldInfo[];
  /** Inferred type structure - metadata for analysis */
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
 * 
 * Types:
 * - signer: Checking signatories or verifying signatures
 * - deadline: Time-based checks on validity range
 * - token: Policy ID or token amount checks
 * - value: ADA or native token value comparisons
 * - owner: Owner/authority checks (PKH comparisons)
 * - signature: Cryptographic signature verification (legacy, maps to signer)
 * - equality: General equality checks
 * - comparison: General numeric comparisons
 */
export interface ValidationCheck {
  type: 'signer' | 'deadline' | 'token' | 'value' | 'owner' | 'signature' | 'equality' | 'comparison' | 'unknown';
  builtin: string;            // The builtin used
  description: string;        // Human-readable description
  location: UplcTerm;         // The AST node
}
