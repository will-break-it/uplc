/**
 * UPLC Lexer - Tokenizes UPLC source text
 */

import type { SourceLocation } from './ast.js';
import { ParseError } from './ast.js';

export type TokenType =
  | 'LPAREN'      // (
  | 'RPAREN'      // )
  | 'LBRACKET'    // [
  | 'RBRACKET'    // ]
  | 'COMMA'       // ,
  | 'VAR'         // var
  | 'LAM'         // lam
  | 'APP'         // app (explicit application)
  | 'CON'         // con
  | 'BUILTIN'     // builtin
  | 'FORCE'       // force
  | 'DELAY'       // delay
  | 'ERROR'       // error
  | 'CASE'        // case (Plutus V3)
  | 'CONSTR'      // constr (Plutus V3)
  | 'PROGRAM'     // program (wrapper)
  | 'VERSION'     // version like 1.0.0
  | 'IDENT'       // identifier/name
  | 'INTEGER'     // numeric literal
  | 'BYTESTRING'  // #hex or 0xhex
  | 'STRING'      // "string"
  | 'BOOL_TRUE'   // True
  | 'BOOL_FALSE'  // False
  | 'UNIT'        // ()
  | 'EOF';

export interface Token {
  type: TokenType;
  value: string;
  location: SourceLocation;
}

const KEYWORDS: Record<string, TokenType> = {
  'var': 'VAR',
  'lam': 'LAM',
  'app': 'APP',
  'con': 'CON',
  'builtin': 'BUILTIN',
  'force': 'FORCE',
  'delay': 'DELAY',
  'error': 'ERROR',
  'case': 'CASE',
  'constr': 'CONSTR',
  'program': 'PROGRAM',
  'True': 'BOOL_TRUE',
  'False': 'BOOL_FALSE',
};

export class Lexer {
  private pos = 0;
  private line = 1;
  private column = 1;
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  private location(): SourceLocation {
    return { line: this.line, column: this.column, offset: this.pos };
  }

  private peek(offset = 0): string {
    return this.source[this.pos + offset] ?? '';
  }

  private advance(): string {
    const ch = this.source[this.pos++] ?? '';
    if (ch === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.advance();
      } else if (ch === '-' && this.peek(1) === '-') {
        // Line comment
        while (this.pos < this.source.length && this.peek() !== '\n') {
          this.advance();
        }
      } else {
        break;
      }
    }
  }

  private readString(): string {
    const start = this.location();
    this.advance(); // consume opening "
    let value = '';
    while (this.pos < this.source.length && this.peek() !== '"') {
      const ch = this.advance();
      if (ch === '\\') {
        const escaped = this.advance();
        switch (escaped) {
          case 'n': value += '\n'; break;
          case 't': value += '\t'; break;
          case 'r': value += '\r'; break;
          case '\\': value += '\\'; break;
          case '"': value += '"'; break;
          default: value += escaped;
        }
      } else {
        value += ch;
      }
    }
    if (this.peek() !== '"') {
      throw new ParseError('Unterminated string', start);
    }
    this.advance(); // consume closing "
    return value;
  }

  private readBytestring(): string {
    // Starts with # or 0x
    let value = '';
    if (this.peek() === '#') {
      this.advance();
    } else if (this.peek() === '0' && this.peek(1) === 'x') {
      this.advance();
      this.advance();
    }
    while (this.pos < this.source.length) {
      const ch = this.peek();
      if (/[0-9a-fA-F]/.test(ch)) {
        value += this.advance();
      } else {
        break;
      }
    }
    return value;
  }

  private readNumber(): string {
    let value = '';
    if (this.peek() === '-') {
      value += this.advance();
    }
    while (this.pos < this.source.length && /[0-9]/.test(this.peek())) {
      value += this.advance();
    }
    return value;
  }

  private readVersion(): string {
    // Read version like "1.0.0" or "1.1.0"
    let value = '';
    while (this.pos < this.source.length && /[0-9.]/.test(this.peek())) {
      value += this.advance();
    }
    return value;
  }

  private readIdentifier(): string {
    let value = '';
    while (this.pos < this.source.length) {
      const ch = this.peek();
      if (/[a-zA-Z0-9_']/.test(ch)) {
        value += this.advance();
      } else {
        break;
      }
    }
    return value;
  }

  tokenize(): Token[] {
    const tokens: Token[] = [];

    while (this.pos < this.source.length) {
      this.skipWhitespace();
      if (this.pos >= this.source.length) break;

      const loc = this.location();
      const ch = this.peek();

      // Single-character tokens
      if (ch === '(') {
        // Check for unit: ()
        if (this.peek(1) === ')') {
          this.advance();
          this.advance();
          tokens.push({ type: 'UNIT', value: '()', location: loc });
          continue;
        }
        this.advance();
        tokens.push({ type: 'LPAREN', value: '(', location: loc });
        continue;
      }

      if (ch === ')') {
        this.advance();
        tokens.push({ type: 'RPAREN', value: ')', location: loc });
        continue;
      }

      if (ch === '[') {
        this.advance();
        tokens.push({ type: 'LBRACKET', value: '[', location: loc });
        continue;
      }

      if (ch === ']') {
        this.advance();
        tokens.push({ type: 'RBRACKET', value: ']', location: loc });
        continue;
      }

      if (ch === ',') {
        this.advance();
        tokens.push({ type: 'COMMA', value: ',', location: loc });
        continue;
      }

      // String literal
      if (ch === '"') {
        const value = this.readString();
        tokens.push({ type: 'STRING', value, location: loc });
        continue;
      }

      // Bytestring (#hex or 0xhex)
      if (ch === '#') {
        const value = this.readBytestring();
        tokens.push({ type: 'BYTESTRING', value, location: loc });
        continue;
      }

      if (ch === '0' && this.peek(1) === 'x') {
        const value = this.readBytestring();
        tokens.push({ type: 'BYTESTRING', value, location: loc });
        continue;
      }

      // Number (integer) or version (e.g., 1.0.0)
      if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(this.peek(1)))) {
        // Check if this looks like a version (number followed by dot)
        const startPos = this.pos;
        const value = this.readNumber();
        
        // If followed by a dot, it's a version number
        if (this.peek() === '.') {
          // Read the rest as version (e.g., ".0.0")
          let version = value;
          while (this.peek() === '.' || /[0-9]/.test(this.peek())) {
            version += this.advance();
          }
          tokens.push({ type: 'VERSION', value: version, location: loc });
        } else {
          tokens.push({ type: 'INTEGER', value, location: loc });
        }
        continue;
      }

      // Identifier or keyword
      if (/[a-zA-Z_]/.test(ch)) {
        const value = this.readIdentifier();
        const type = KEYWORDS[value] ?? 'IDENT';
        tokens.push({ type, value, location: loc });
        continue;
      }

      throw new ParseError(`Unexpected character: '${ch}'`, loc);
    }

    tokens.push({ type: 'EOF', value: '', location: this.location() });
    return tokens;
  }
}

export function tokenize(source: string): Token[] {
  return new Lexer(source).tokenize();
}
