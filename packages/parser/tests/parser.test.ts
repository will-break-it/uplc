import { describe, it, expect } from 'vitest';
import { parseUplc, tokenize, ParseError, type UplcTerm } from '../src/index.js';

describe('Lexer', () => {
  it('tokenizes simple terms', () => {
    const tokens = tokenize('(var x)');
    expect(tokens.map(t => t.type)).toEqual(['LPAREN', 'VAR', 'IDENT', 'RPAREN', 'EOF']);
  });

  it('tokenizes brackets', () => {
    const tokens = tokenize('[f x]');
    expect(tokens.map(t => t.type)).toEqual(['LBRACKET', 'IDENT', 'IDENT', 'RBRACKET', 'EOF']);
  });

  it('tokenizes bytestrings with #', () => {
    const tokens = tokenize('#deadbeef');
    expect(tokens[0]?.type).toBe('BYTESTRING');
    expect(tokens[0]?.value).toBe('deadbeef');
  });

  it('tokenizes bytestrings with 0x', () => {
    const tokens = tokenize('0xCAFE');
    expect(tokens[0]?.type).toBe('BYTESTRING');
    expect(tokens[0]?.value).toBe('CAFE');
  });

  it('tokenizes strings', () => {
    const tokens = tokenize('"hello world"');
    expect(tokens[0]?.type).toBe('STRING');
    expect(tokens[0]?.value).toBe('hello world');
  });

  it('tokenizes negative numbers', () => {
    const tokens = tokenize('-42');
    expect(tokens[0]?.type).toBe('INTEGER');
    expect(tokens[0]?.value).toBe('-42');
  });

  it('handles comments', () => {
    const tokens = tokenize('(var x) -- this is a comment\n(var y)');
    expect(tokens.filter(t => t.type === 'VAR')).toHaveLength(2);
  });

  it('handles unit ()', () => {
    const tokens = tokenize('()');
    expect(tokens[0]?.type).toBe('UNIT');
  });
});

describe('Parser - Simple Terms', () => {
  it('parses var', () => {
    const ast = parseUplc('(var x)');
    expect(ast).toEqual({ tag: 'var', name: 'x' });
  });

  it('parses error', () => {
    const ast = parseUplc('(error)');
    expect(ast).toEqual({ tag: 'error' });
  });

  it('parses builtin', () => {
    const ast = parseUplc('(builtin addInteger)');
    expect(ast).toEqual({ tag: 'builtin', name: 'addInteger' });
  });

  it('parses builtin with underscores', () => {
    const ast = parseUplc('(builtin verify_ed25519_signature)');
    expect(ast).toEqual({ tag: 'builtin', name: 'verify_ed25519_signature' });
  });
});

describe('Parser - Lambda', () => {
  it('parses simple lambda', () => {
    const ast = parseUplc('(lam x (var x))');
    expect(ast).toEqual({
      tag: 'lam',
      param: 'x',
      body: { tag: 'var', name: 'x' }
    });
  });

  it('parses nested lambdas', () => {
    const ast = parseUplc('(lam x (lam y (var x)))');
    expect(ast).toEqual({
      tag: 'lam',
      param: 'x',
      body: {
        tag: 'lam',
        param: 'y',
        body: { tag: 'var', name: 'x' }
      }
    });
  });
});

describe('Parser - Application', () => {
  it('parses explicit app', () => {
    const ast = parseUplc('(app (var f) (var x))');
    expect(ast).toEqual({
      tag: 'app',
      func: { tag: 'var', name: 'f' },
      arg: { tag: 'var', name: 'x' }
    });
  });

  it('parses bracket application [f x]', () => {
    const ast = parseUplc('[(var f) (var x)]');
    expect(ast).toEqual({
      tag: 'app',
      func: { tag: 'var', name: 'f' },
      arg: { tag: 'var', name: 'x' }
    });
  });

  it('parses nested bracket applications [[[f a] b] c]', () => {
    const ast = parseUplc('[[[[(builtin addInteger) (var a)] (var b)] (var c)] (var d)]');
    expect(ast.tag).toBe('app');
    expect((ast as any).arg).toEqual({ tag: 'var', name: 'd' });
  });

  it('handles multiple args in single bracket', () => {
    const ast = parseUplc('[(builtin addInteger) (var x) (var y)]');
    expect(ast).toEqual({
      tag: 'app',
      func: {
        tag: 'app',
        func: { tag: 'builtin', name: 'addInteger' },
        arg: { tag: 'var', name: 'x' }
      },
      arg: { tag: 'var', name: 'y' }
    });
  });
});

describe('Parser - Constants', () => {
  it('parses integer constant', () => {
    const ast = parseUplc('(con integer 42)');
    expect(ast).toEqual({
      tag: 'con',
      type: 'integer',
      value: { tag: 'integer', value: 42n }
    });
  });

  it('parses negative integer', () => {
    const ast = parseUplc('(con integer -123)');
    expect(ast).toEqual({
      tag: 'con',
      type: 'integer',
      value: { tag: 'integer', value: -123n }
    });
  });

  it('parses large integer (bigint)', () => {
    const ast = parseUplc('(con integer 999999999999999999999999999999)');
    expect(ast.tag).toBe('con');
    expect((ast as any).value.value).toBe(999999999999999999999999999999n);
  });

  it('parses bytestring with #', () => {
    const ast = parseUplc('(con bytestring #deadbeef)');
    expect(ast.tag).toBe('con');
    expect((ast as any).value.tag).toBe('bytestring');
    expect(Array.from((ast as any).value.value)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('parses bytestring with 0x', () => {
    const ast = parseUplc('(con bytestring 0xcafe)');
    expect(ast.tag).toBe('con');
    expect(Array.from((ast as any).value.value)).toEqual([0xca, 0xfe]);
  });

  it('parses empty bytestring', () => {
    const ast = parseUplc('(con bytestring #)');
    expect(ast.tag).toBe('con');
    expect((ast as any).value.value.length).toBe(0);
  });

  it('parses string constant', () => {
    const ast = parseUplc('(con string "hello world")');
    expect(ast).toEqual({
      tag: 'con',
      type: 'string',
      value: { tag: 'string', value: 'hello world' }
    });
  });

  it('parses string with escapes', () => {
    const ast = parseUplc('(con string "hello\\nworld")');
    expect((ast as any).value.value).toBe('hello\nworld');
  });

  it('parses bool True', () => {
    const ast = parseUplc('(con bool True)');
    expect(ast).toEqual({
      tag: 'con',
      type: 'bool',
      value: { tag: 'bool', value: true }
    });
  });

  it('parses bool False', () => {
    const ast = parseUplc('(con bool False)');
    expect(ast).toEqual({
      tag: 'con',
      type: 'bool',
      value: { tag: 'bool', value: false }
    });
  });

  it('parses unit', () => {
    const ast = parseUplc('(con unit ())');
    expect(ast).toEqual({
      tag: 'con',
      type: 'unit',
      value: { tag: 'unit' }
    });
  });
});

describe('Parser - Force and Delay', () => {
  it('parses force', () => {
    const ast = parseUplc('(force (builtin ifThenElse))');
    expect(ast).toEqual({
      tag: 'force',
      term: { tag: 'builtin', name: 'ifThenElse' }
    });
  });

  it('parses delay', () => {
    const ast = parseUplc('(delay (var x))');
    expect(ast).toEqual({
      tag: 'delay',
      term: { tag: 'var', name: 'x' }
    });
  });

  it('parses double force', () => {
    const ast = parseUplc('(force (force (builtin fstPair)))');
    expect(ast).toEqual({
      tag: 'force',
      term: {
        tag: 'force',
        term: { tag: 'builtin', name: 'fstPair' }
      }
    });
  });
});

describe('Parser - Complex Nested Terms', () => {
  it('parses identity function application', () => {
    const ast = parseUplc('[(lam x (var x)) (con integer 42)]');
    expect(ast).toEqual({
      tag: 'app',
      func: {
        tag: 'lam',
        param: 'x',
        body: { tag: 'var', name: 'x' }
      },
      arg: {
        tag: 'con',
        type: 'integer',
        value: { tag: 'integer', value: 42n }
      }
    });
  });

  it('parses add function', () => {
    const source = '(lam x (lam y [[(force (force (builtin addInteger))) (var x)] (var y)]))';
    const ast = parseUplc(source);
    expect(ast.tag).toBe('lam');
    expect((ast as any).param).toBe('x');
    expect((ast as any).body.tag).toBe('lam');
    expect((ast as any).body.param).toBe('y');
  });

  it('parses Church numeral zero', () => {
    const ast = parseUplc('(lam f (lam x (var x)))');
    expect(ast).toEqual({
      tag: 'lam',
      param: 'f',
      body: {
        tag: 'lam',
        param: 'x',
        body: { tag: 'var', name: 'x' }
      }
    });
  });

  it('parses Church numeral one', () => {
    const ast = parseUplc('(lam f (lam x [(var f) (var x)]))');
    expect(ast).toEqual({
      tag: 'lam',
      param: 'f',
      body: {
        tag: 'lam',
        param: 'x',
        body: {
          tag: 'app',
          func: { tag: 'var', name: 'f' },
          arg: { tag: 'var', name: 'x' }
        }
      }
    });
  });
});

describe('Parser - Real UPLC Snippet', () => {
  it('parses a simple validator structure', () => {
    const source = `
      (lam datum
        (lam redeemer
          (lam ctx
            [
              [
                [
                  (force (builtin ifThenElse))
                  [(builtin equalsInteger) (var datum) (con integer 42)]
                ]
                (con unit ())
              ]
              (error)
            ]
          )
        )
      )
    `;
    const ast = parseUplc(source);
    expect(ast.tag).toBe('lam');
    expect((ast as any).param).toBe('datum');
    expect((ast as any).body.tag).toBe('lam');
    expect((ast as any).body.param).toBe('redeemer');
    expect((ast as any).body.body.tag).toBe('lam');
    expect((ast as any).body.body.param).toBe('ctx');
  });

  it('parses builtin with multiple force applications', () => {
    const source = '(force (force (builtin chooseList)))';
    const ast = parseUplc(source);
    expect(ast).toEqual({
      tag: 'force',
      term: {
        tag: 'force',
        term: { tag: 'builtin', name: 'chooseList' }
      }
    });
  });
});

describe('Parser - Error Handling', () => {
  it('throws on unexpected token', () => {
    expect(() => parseUplc('{')).toThrow(ParseError);
  });

  it('throws on unclosed paren', () => {
    expect(() => parseUplc('(var x')).toThrow(ParseError);
  });

  it('throws on unclosed bracket', () => {
    expect(() => parseUplc('[(var f) (var x)')).toThrow(ParseError);
  });

  it('throws on unknown keyword', () => {
    expect(() => parseUplc('(unknown x)')).toThrow(ParseError);
  });

  it('provides line and column info', () => {
    try {
      parseUplc('(var x)\n(invalid y)');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).location.line).toBe(2);
    }
  });
});

describe('Parser - Whitespace Handling', () => {
  it('handles various whitespace', () => {
    const ast = parseUplc('  (  var   x  )  ');
    expect(ast).toEqual({ tag: 'var', name: 'x' });
  });

  it('handles newlines in terms', () => {
    const ast = parseUplc(`(lam x
      (lam y
        (var x)))`);
    expect(ast.tag).toBe('lam');
    expect((ast as any).body.tag).toBe('lam');
  });

  it('handles tabs', () => {
    const ast = parseUplc('(var\t\tx)');
    expect(ast).toEqual({ tag: 'var', name: 'x' });
  });
});

describe('Parser - PlutusData', () => {
  it('parses Constr data', () => {
    const ast = parseUplc('(con data Constr 0 [I 42])');
    expect(ast.tag).toBe('con');
    expect((ast as any).value.tag).toBe('data');
    expect((ast as any).value.value).toEqual({
      tag: 'constr',
      index: 0,
      fields: [{ tag: 'int', value: 42n }]
    });
  });

  it('parses nested Constr', () => {
    const ast = parseUplc('(con data Constr 1 [Constr 0 [I 1, I 2], I 3])');
    expect((ast as any).value.value.tag).toBe('constr');
    expect((ast as any).value.value.index).toBe(1);
    expect((ast as any).value.value.fields).toHaveLength(2);
  });

  it('parses bytes in data', () => {
    const ast = parseUplc('(con data B #cafe)');
    expect((ast as any).value.value).toEqual({
      tag: 'bytes',
      value: new Uint8Array([0xca, 0xfe])
    });
  });

  it('parses List data', () => {
    const ast = parseUplc('(con data List [I 1, I 2, I 3])');
    expect((ast as any).value.value).toEqual({
      tag: 'list',
      items: [
        { tag: 'int', value: 1n },
        { tag: 'int', value: 2n },
        { tag: 'int', value: 3n }
      ]
    });
  });

  it('parses Map data', () => {
    const ast = parseUplc('(con data Map [[I 1, I 2], [I 3, I 4]])');
    expect((ast as any).value.value).toEqual({
      tag: 'map',
      entries: [
        [{ tag: 'int', value: 1n }, { tag: 'int', value: 2n }],
        [{ tag: 'int', value: 3n }, { tag: 'int', value: 4n }]
      ]
    });
  });
});
