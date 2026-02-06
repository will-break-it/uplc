/**
 * UPLC Parser - Converts tokens to AST
 */

import { Token, TokenType, tokenize } from './lexer.js';
import { UplcTerm, UplcValue, PlutusData, ParseError, SourceLocation } from './ast.js';

export class Parser {
  private tokens: Token[] = [];
  private pos = 0;

  constructor(source: string) {
    this.tokens = tokenize(source);
  }

  private current(): Token {
    return this.tokens[this.pos] ?? this.tokens[this.tokens.length - 1]!;
  }

  private peek(offset = 0): Token {
    return this.tokens[this.pos + offset] ?? this.tokens[this.tokens.length - 1]!;
  }

  private advance(): Token {
    const token = this.current();
    if (token.type !== 'EOF') {
      this.pos++;
    }
    return token;
  }

  private expect(type: TokenType, context?: string): Token {
    const token = this.current();
    if (token.type !== type) {
      const ctx = context ? ` in ${context}` : '';
      throw new ParseError(
        `Expected ${type} but got ${token.type}${ctx}`,
        token.location
      );
    }
    return this.advance();
  }

  private expectIdent(context?: string): string {
    const token = this.current();
    // Accept IDENT or any keyword as identifier in certain contexts
    if (token.type === 'IDENT' || token.type in { VAR: 1, LAM: 1, APP: 1, CON: 1, BUILTIN: 1, FORCE: 1, DELAY: 1, ERROR: 1 }) {
      this.advance();
      return token.value;
    }
    throw new ParseError(
      `Expected identifier but got ${token.type}${context ? ` in ${context}` : ''}`,
      token.location
    );
  }

  parse(): UplcTerm {
    const term = this.parseTerm();
    if (this.current().type !== 'EOF') {
      throw new ParseError(
        `Unexpected token after term: ${this.current().type}`,
        this.current().location
      );
    }
    return term;
  }

  private parseTerm(): UplcTerm {
    const token = this.current();

    // Bracketed application: [f x]
    if (token.type === 'LBRACKET') {
      return this.parseBracketApp();
    }

    // Parenthesized term
    if (token.type === 'LPAREN') {
      return this.parseParenTerm();
    }

    throw new ParseError(
      `Expected term, got ${token.type}`,
      token.location
    );
  }

  private parseBracketApp(): UplcTerm {
    this.expect('LBRACKET');
    
    // Parse all terms inside brackets
    const terms: UplcTerm[] = [];
    while (this.current().type !== 'RBRACKET' && this.current().type !== 'EOF') {
      terms.push(this.parseTerm());
    }
    this.expect('RBRACKET', 'bracket application');

    if (terms.length < 2) {
      throw new ParseError(
        'Bracket application requires at least 2 terms',
        this.current().location
      );
    }

    // Left-fold into nested applications: [f a b] => ((f a) b)
    let result = terms[0]!;
    for (let i = 1; i < terms.length; i++) {
      result = { tag: 'app', func: result, arg: terms[i]! };
    }
    return result;
  }

  private parseParenTerm(): UplcTerm {
    this.expect('LPAREN');
    const token = this.current();

    switch (token.type) {
      case 'VAR': {
        this.advance();
        const name = this.expectIdent('var');
        this.expect('RPAREN', 'var');
        return { tag: 'var', name };
      }

      case 'LAM': {
        this.advance();
        const param = this.expectIdent('lam parameter');
        const body = this.parseTerm();
        this.expect('RPAREN', 'lam');
        return { tag: 'lam', param, body };
      }

      case 'APP': {
        this.advance();
        const func = this.parseTerm();
        const arg = this.parseTerm();
        this.expect('RPAREN', 'app');
        return { tag: 'app', func, arg };
      }

      case 'CON': {
        this.advance();
        const { type, value } = this.parseConstant();
        this.expect('RPAREN', 'con');
        return { tag: 'con', type, value };
      }

      case 'BUILTIN': {
        this.advance();
        const name = this.expectIdent('builtin');
        this.expect('RPAREN', 'builtin');
        return { tag: 'builtin', name };
      }

      case 'FORCE': {
        this.advance();
        const term = this.parseTerm();
        this.expect('RPAREN', 'force');
        return { tag: 'force', term };
      }

      case 'DELAY': {
        this.advance();
        const term = this.parseTerm();
        this.expect('RPAREN', 'delay');
        return { tag: 'delay', term };
      }

      case 'ERROR': {
        this.advance();
        this.expect('RPAREN', 'error');
        return { tag: 'error' };
      }

      default:
        throw new ParseError(
          `Expected term keyword, got ${token.type}`,
          token.location
        );
    }
  }

  private parseConstant(): { type: string; value: UplcValue } {
    // Parse type name (can be complex like "list integer" or "pair integer bytestring")
    const type = this.parseTypeName();
    const value = this.parseValue(type);
    return { type, value };
  }

  private parseTypeName(): string {
    const parts: string[] = [];
    
    // Handle parenthesized types like (list integer) or (pair integer bytestring)
    if (this.current().type === 'LPAREN') {
      this.advance();
      while (this.current().type !== 'RPAREN' && this.current().type !== 'EOF') {
        if (this.current().type === 'LPAREN') {
          parts.push('(' + this.parseTypeName() + ')');
        } else if (this.current().type === 'IDENT') {
          parts.push(this.advance().value);
        } else {
          break;
        }
      }
      this.expect('RPAREN', 'type');
      return parts.join(' ');
    }

    // Simple type name
    const token = this.current();
    if (token.type === 'IDENT') {
      this.advance();
      return token.value;
    }

    throw new ParseError(`Expected type name, got ${token.type}`, token.location);
  }

  private parseValue(type: string): UplcValue {
    const token = this.current();
    const baseType = type.split(' ')[0] ?? type;

    switch (baseType) {
      case 'integer': {
        if (token.type === 'INTEGER') {
          this.advance();
          return { tag: 'integer', value: BigInt(token.value) };
        }
        // Handle negative with explicit minus
        if (token.type === 'IDENT' && token.value === '-') {
          this.advance();
          const numToken = this.expect('INTEGER', 'negative integer');
          return { tag: 'integer', value: BigInt('-' + numToken.value) };
        }
        throw new ParseError(`Expected integer, got ${token.type}`, token.location);
      }

      case 'bytestring': {
        if (token.type === 'BYTESTRING') {
          this.advance();
          return { tag: 'bytestring', value: hexToBytes(token.value) };
        }
        throw new ParseError(`Expected bytestring, got ${token.type}`, token.location);
      }

      case 'string': {
        if (token.type === 'STRING') {
          this.advance();
          return { tag: 'string', value: token.value };
        }
        throw new ParseError(`Expected string, got ${token.type}`, token.location);
      }

      case 'bool': {
        if (token.type === 'BOOL_TRUE') {
          this.advance();
          return { tag: 'bool', value: true };
        }
        if (token.type === 'BOOL_FALSE') {
          this.advance();
          return { tag: 'bool', value: false };
        }
        throw new ParseError(`Expected bool, got ${token.type}`, token.location);
      }

      case 'unit': {
        if (token.type === 'UNIT') {
          this.advance();
          return { tag: 'unit' };
        }
        // Also accept just nothing before the closing paren
        return { tag: 'unit' };
      }

      case 'list': {
        return this.parseListValue(type);
      }

      case 'pair': {
        return this.parsePairValue(type);
      }

      case 'data': {
        return { tag: 'data', value: this.parsePlutusData() };
      }

      default:
        throw new ParseError(`Unknown constant type: ${type}`, token.location);
    }
  }

  private parseListValue(type: string): UplcValue {
    // type is like "list integer"
    const elementType = type.substring(5).trim(); // Remove "list "
    const items: UplcValue[] = [];

    this.expect('LBRACKET', 'list value');
    while (this.current().type !== 'RBRACKET' && this.current().type !== 'EOF') {
      items.push(this.parseValue(elementType));
      // Optional comma
      if (this.current().type === 'COMMA') {
        this.advance();
      }
    }
    this.expect('RBRACKET', 'list value');

    return { tag: 'list', elementType, items };
  }

  private parsePairValue(type: string): UplcValue {
    // type is like "pair integer bytestring"
    const parts = type.substring(5).trim().split(' '); // Remove "pair "
    const fstType = parts[0] ?? 'integer';
    const sndType = parts.slice(1).join(' ') || 'integer';

    this.expect('LPAREN', 'pair value');
    const fst = this.parseValue(fstType);
    // Optional comma
    if (this.current().type === 'COMMA') {
      this.advance();
    }
    const snd = this.parseValue(sndType);
    this.expect('RPAREN', 'pair value');

    return { tag: 'pair', fstType, sndType, fst, snd };
  }

  private parsePlutusData(): PlutusData {
    const token = this.current();

    // Constr: Constr index [fields...]
    if (token.type === 'IDENT' && token.value === 'Constr') {
      this.advance();
      const indexToken = this.expect('INTEGER', 'Constr index');
      const index = parseInt(indexToken.value, 10);
      
      const fields: PlutusData[] = [];
      this.expect('LBRACKET', 'Constr fields');
      while (this.current().type !== 'RBRACKET' && this.current().type !== 'EOF') {
        fields.push(this.parsePlutusData());
        if (this.current().type === 'COMMA') {
          this.advance();
        }
      }
      this.expect('RBRACKET', 'Constr fields');
      
      return { tag: 'constr', index, fields };
    }

    // Map: Map [[k, v], ...]
    if (token.type === 'IDENT' && token.value === 'Map') {
      this.advance();
      const entries: [PlutusData, PlutusData][] = [];
      this.expect('LBRACKET', 'Map entries');
      while (this.current().type !== 'RBRACKET' && this.current().type !== 'EOF') {
        this.expect('LBRACKET', 'Map entry');
        const key = this.parsePlutusData();
        if (this.current().type === 'COMMA') {
          this.advance();
        }
        const val = this.parsePlutusData();
        this.expect('RBRACKET', 'Map entry');
        entries.push([key, val]);
        if (this.current().type === 'COMMA') {
          this.advance();
        }
      }
      this.expect('RBRACKET', 'Map entries');
      
      return { tag: 'map', entries };
    }

    // List: List [items...]
    if (token.type === 'IDENT' && token.value === 'List') {
      this.advance();
      const items: PlutusData[] = [];
      this.expect('LBRACKET', 'List items');
      while (this.current().type !== 'RBRACKET' && this.current().type !== 'EOF') {
        items.push(this.parsePlutusData());
        if (this.current().type === 'COMMA') {
          this.advance();
        }
      }
      this.expect('RBRACKET', 'List items');
      
      return { tag: 'list', items };
    }

    // I (integer): I 42
    if (token.type === 'IDENT' && token.value === 'I') {
      this.advance();
      const numToken = this.current();
      if (numToken.type === 'INTEGER') {
        this.advance();
        return { tag: 'int', value: BigInt(numToken.value) };
      }
      throw new ParseError(`Expected integer after I, got ${numToken.type}`, numToken.location);
    }

    // B (bytes): B #hex
    if (token.type === 'IDENT' && token.value === 'B') {
      this.advance();
      const bytesToken = this.current();
      if (bytesToken.type === 'BYTESTRING') {
        this.advance();
        return { tag: 'bytes', value: hexToBytes(bytesToken.value) };
      }
      throw new ParseError(`Expected bytestring after B, got ${bytesToken.type}`, bytesToken.location);
    }

    throw new ParseError(`Expected PlutusData, got ${token.type} (${token.value})`, token.location);
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

export function parseUplc(source: string): UplcTerm {
  return new Parser(source).parse();
}
