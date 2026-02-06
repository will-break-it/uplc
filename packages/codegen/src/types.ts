/**
 * Code Generation Types
 */

/**
 * Options for code generation
 */
export interface GeneratorOptions {
  /** Include comments with analysis notes */
  comments: boolean;
  
  /** Naming style for inferred names */
  namingStyle: 'generic' | 'descriptive';
  
  /** Include type annotations */
  includeTypes: boolean;
  
  /** Indent string (default: 2 spaces) */
  indent: string;
}

/**
 * Generated code output
 */
export interface GeneratedCode {
  /** The validator block */
  validator: ValidatorBlock;
  
  /** Type definitions needed */
  types: TypeDefinition[];
  
  /** Import statements */
  imports: string[];
}

/**
 * A validator block
 */
export interface ValidatorBlock {
  name: string;
  params: ParameterInfo[];
  handlers: HandlerBlock[];
}

/**
 * A handler within a validator (spend, mint, etc.)
 */
export interface HandlerBlock {
  kind: 'spend' | 'mint' | 'withdraw' | 'publish' | 'vote' | 'propose' | 'fallback';
  params: ParameterInfo[];
  body: CodeBlock;
}

/**
 * Parameter information
 */
export interface ParameterInfo {
  name: string;
  type: string;
  isOptional?: boolean;
}

/**
 * A block of generated code
 */
export interface CodeBlock {
  kind: 'when' | 'if' | 'let' | 'expect' | 'expression' | 'block';
  content: string | CodeBlock[];
  condition?: string;
  branches?: BranchBlock[];
}

/**
 * A branch in a when/if expression
 */
export interface BranchBlock {
  pattern: string;
  body: CodeBlock;
}

/**
 * A type definition
 */
export interface TypeDefinition {
  name: string;
  kind: 'enum' | 'struct';
  variants?: VariantDefinition[];
  fields?: FieldDefinition[];
}

/**
 * An enum variant
 */
export interface VariantDefinition {
  name: string;
  fields?: FieldDefinition[];
}

/**
 * A field in a struct or variant
 */
export interface FieldDefinition {
  name: string;
  type: string;
}
