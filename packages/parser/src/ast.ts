/**
 * UPLC Abstract Syntax Tree Types
 */

/**
 * Plutus Data - the on-chain data format
 */
export type PlutusData =
  | { tag: 'constr'; index: number; fields: PlutusData[] }
  | { tag: 'map'; entries: [PlutusData, PlutusData][] }
  | { tag: 'list'; items: PlutusData[] }
  | { tag: 'int'; value: bigint }
  | { tag: 'bytes'; value: Uint8Array };

/**
 * UPLC constant values
 */
export type UplcValue =
  | { tag: 'integer'; value: bigint }
  | { tag: 'bytestring'; value: Uint8Array }
  | { tag: 'string'; value: string }
  | { tag: 'bool'; value: boolean }
  | { tag: 'unit' }
  | { tag: 'list'; elementType: string; items: UplcValue[] }
  | { tag: 'pair'; fstType: string; sndType: string; fst: UplcValue; snd: UplcValue }
  | { tag: 'data'; value: PlutusData };

/**
 * UPLC terms - the core AST
 */
export type UplcTerm =
  | { tag: 'var'; name: string }
  | { tag: 'lam'; param: string; body: UplcTerm }
  | { tag: 'app'; func: UplcTerm; arg: UplcTerm }
  | { tag: 'con'; type: string; value: UplcValue }
  | { tag: 'builtin'; name: string }
  | { tag: 'force'; term: UplcTerm }
  | { tag: 'delay'; term: UplcTerm }
  | { tag: 'error' }
  // Plutus V3 constructs
  | { tag: 'case'; scrutinee: UplcTerm; branches: UplcTerm[] }
  | { tag: 'constr'; index: number; args: UplcTerm[] };

/**
 * Source location for error reporting
 */
export interface SourceLocation {
  line: number;
  column: number;
  offset: number;
}

/**
 * Parse error with location info
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public location: SourceLocation
  ) {
    super(`${message} at line ${location.line}, column ${location.column}`);
    this.name = 'ParseError';
  }
}
