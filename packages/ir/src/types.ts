/**
 * @uplc/ir - Intermediate Representation
 *
 * Simplified IR between UPLC AST and target code generation.
 * Enables optimizations, better code generation, and multi-target output.
 */

import type { UplcTerm } from '@uplc/parser';

/**
 * IR Type System - richer than UPLC, simpler than Aiken
 */
export type IRType =
  | { kind: 'int' }
  | { kind: 'bool' }
  | { kind: 'bytes' }
  | { kind: 'string' }
  | { kind: 'unit' }
  | { kind: 'list'; elementType: IRType }
  | { kind: 'tuple'; types: IRType[] }
  | { kind: 'option'; innerType: IRType }
  | { kind: 'custom'; name: string; fields?: IRFieldType[] }
  | { kind: 'function'; params: IRType[]; returns: IRType }
  | { kind: 'unknown' };

export interface IRFieldType {
  name: string;
  type: IRType;
  optional?: boolean;
}

/**
 * IR Expression - high-level operations
 */
export type IRExpression =
  | { kind: 'literal'; type: IRType; value: any }
  | { kind: 'variable'; name: string; type: IRType }
  | { kind: 'binary'; op: BinaryOp; left: IRExpression; right: IRExpression; type: IRType }
  | { kind: 'unary'; op: UnaryOp; operand: IRExpression; type: IRType }
  | { kind: 'call'; func: IRExpression; args: IRExpression[]; type: IRType }
  | { kind: 'member'; object: IRExpression; member: string; type: IRType }
  | { kind: 'index'; object: IRExpression; index: IRExpression; type: IRType }
  | { kind: 'lambda'; params: IRParameter[]; body: IRStatement[]; type: IRType }
  | { kind: 'constructor'; typeName: string; args: IRExpression[]; type: IRType }
  | { kind: 'when'; scrutinee: IRExpression; branches: IRWhenBranch[]; type: IRType };

export type BinaryOp =
  | 'add' | 'sub' | 'mul' | 'div' | 'mod'
  | 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge'
  | 'and' | 'or'
  | 'concat';

export type UnaryOp = 'not' | 'negate';

export interface IRWhenBranch {
  pattern: IRPattern;
  guard?: IRExpression;
  body: IRStatement[];
}

export type IRPattern =
  | { kind: 'wildcard' }
  | { kind: 'literal'; value: any }
  | { kind: 'variable'; name: string; type: IRType }
  | { kind: 'constructor'; name: string; args: IRPattern[] }
  | { kind: 'tuple'; elements: IRPattern[] };

/**
 * IR Statement - control flow
 */
export type IRStatement =
  | { kind: 'let'; name: string; type: IRType; value: IRExpression }
  | { kind: 'expect'; pattern: IRPattern; value: IRExpression; errorMsg?: string }
  | { kind: 'return'; value: IRExpression }
  | { kind: 'if'; condition: IRExpression; then: IRStatement[]; else?: IRStatement[] }
  | { kind: 'when'; scrutinee: IRExpression; branches: IRWhenBranch[] }
  | { kind: 'expression'; value: IRExpression }
  | { kind: 'fail'; message?: string };

export interface IRParameter {
  name: string;
  type: IRType;
  optional?: boolean;
}

/**
 * IR Function - top-level functions
 */
export interface IRFunction {
  name: string;
  params: IRParameter[];
  returnType: IRType;
  body: IRStatement[];
  annotations?: string[];
  sourceMap?: SourceMapEntry[];
}

/**
 * IR Type Definition
 */
export type IRTypeDefinition =
  | { kind: 'struct'; name: string; fields: IRFieldType[] }
  | { kind: 'enum'; name: string; variants: IREnumVariant[] };

export interface IREnumVariant {
  name: string;
  fields?: IRFieldType[];
}

/**
 * IR Module - complete program
 */
export interface IRModule {
  types: IRTypeDefinition[];
  functions: IRFunction[];
  imports: IRImport[];
  constants?: IRConstant[];
}

export interface IRImport {
  module: string;
  items?: string[];
}

export interface IRConstant {
  name: string;
  type: IRType;
  value: any;
}

/**
 * Source Map Entry
 */
export interface SourceMapEntry {
  irPosition: { line: number; column: number };
  uplcTerm: UplcTerm;
  uplcPosition?: { offset: number; length: number };
}

/**
 * Optimization metadata
 */
export interface OptimizationHint {
  kind: 'inline' | 'dead_code' | 'constant_fold' | 'tail_call';
  target: string;
  confidence: number;
}
