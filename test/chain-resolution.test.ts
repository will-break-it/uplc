import { describe, it, expect } from 'vitest';
import { BindingEnvironment, generateValidator } from '@uplc/codegen';
import type { ContractStructure } from '@uplc/patterns';

// Manually construct an AST with chain: a -> b -> c -> constant
// This simulates: let a = b in let b = c in let c = 42 in a
function makeChainAst() {
  // Innermost: let c = 42 in ... uses c
  const innerBody = { 
    tag: 'var', 
    name: 'a'  // Use variable a at the end
  };
  
  // c = (con integer 42)
  const letC = {
    tag: 'app',
    func: { 
      tag: 'lam', 
      param: 'c',
      body: { tag: 'var', name: 'c' }  // body that uses c will be replaced
    },
    arg: { tag: 'con', value: { tag: 'integer', value: 42n } }
  };
  
  // b = c (just a variable reference)
  const letB = {
    tag: 'app',
    func: { 
      tag: 'lam', 
      param: 'b',
      body: letC  // letC is nested inside
    },
    arg: { tag: 'var', name: 'c' }
  };
  
  // a = b (just a variable reference)  
  const letA = {
    tag: 'app',
    func: { 
      tag: 'lam', 
      param: 'a',
      body: letB  // letB is nested inside
    },
    arg: { tag: 'var', name: 'b' }
  };
  
  return letA;
}

// Simpler test: let a = 42 in a
function makeSimpleAst() {
  return {
    tag: 'app',
    func: { 
      tag: 'lam', 
      param: 'a',
      body: { tag: 'var', name: 'a' }
    },
    arg: { tag: 'con', value: { tag: 'integer', value: 42n } }
  };
}

describe('Chain resolution', () => {
  it('simple constant binding should be inline', () => {
    const ast = makeSimpleAst();
    const env = BindingEnvironment.build(ast);
    const a = env.get('a');
    
    console.log('Simple binding a:', a);
    
    expect(a).toBeDefined();
    expect(a?.category).toBe('inline');
    expect(a?.inlineValue).toBe('42');
  });
  
  it('chain binding should resolve', () => {
    const ast = makeChainAst();
    const env = BindingEnvironment.build(ast);
    
    const a = env.get('a');
    const b = env.get('b');
    const c = env.get('c');
    
    console.log('Chain binding a:', a);
    console.log('Chain binding b:', b);
    console.log('Chain binding c:', c);
    
    // c should be inline (direct constant)
    expect(c?.category).toBe('inline');
    expect(c?.inlineValue).toBe('42');
    
    // b is a var reference to c - currently this will be 'keep'
    // After fix, it should ideally resolve to inline
    console.log('b category:', b?.category);
    
    // a is a var reference to b - currently this will be 'keep'  
    // After fix, it should ideally resolve to inline
    console.log('a category:', a?.category);
  });
  
  it('generates code with chain resolution', () => {
    // Build AST: let c = 42 in let b = c in let a = b in a
    // This should output: 42
    const ast = {
      tag: 'app',
      func: {
        tag: 'lam',
        param: 'c',
        body: {
          tag: 'app',
          func: {
            tag: 'lam',
            param: 'b',
            body: {
              tag: 'app',
              func: {
                tag: 'lam',
                param: 'a',
                body: { tag: 'var', name: 'a' }
              },
              arg: { tag: 'var', name: 'b' }
            }
          },
          arg: { tag: 'var', name: 'c' }
        }
      },
      arg: { tag: 'con', value: { tag: 'integer', value: 42n } }
    };
    
    const structure: ContractStructure = {
      type: 'spend',
      params: [],
      datum: { isUsed: false, fields: [] },
      redeemer: { variants: [] },
      checks: [],
      rawBody: ast,
      fullAst: ast,
      utilityBindings: {}
    };
    
    const result = generateValidator(structure);
    console.log('Generated code:', result);
    
    // The output should contain 42, not 'a' or 'b'
    const code = JSON.stringify(result);
    console.log('Output body:', result.validator.handlers[0].body);
    
    expect(result.validator.handlers[0].body.content).toBe('42');
  });
  
  it('chains with complex expressions', () => {
    // let c = 42 in let b = add(c, 1) in b
    // This tests if constants inside complex expressions are resolved
    const ast = {
      tag: 'app',
      func: {
        tag: 'lam',
        param: 'c',
        body: {
          tag: 'app',
          func: {
            tag: 'lam',
            param: 'b',
            body: { tag: 'var', name: 'b' }
          },
          arg: {
            tag: 'app',
            func: {
              tag: 'app',
              func: { tag: 'builtin', name: 'addInteger' },
              arg: { tag: 'var', name: 'c' }
            },
            arg: { tag: 'con', value: { tag: 'integer', value: 1n } }
          }
        }
      },
      arg: { tag: 'con', value: { tag: 'integer', value: 42n } }
    };
    
    const structure: ContractStructure = {
      type: 'spend',
      params: [],
      datum: { isUsed: false, fields: [] },
      redeemer: { variants: [] },
      checks: [],
      rawBody: ast,
      fullAst: ast,
      utilityBindings: {}
    };
    
    const result = generateValidator(structure);
    const content = result.validator.handlers[0].body.content;
    console.log('Complex chain output:', content);
    
    // The output should contain both 42 and 1
    // Expected: (42 + 1) or similar
    expect(content).toContain('42');
    expect(content).toContain('1');
  });
  
  it('chains that pass through let bindings', () => {
    // let c = 42 in let x = (let b = c in b) in x
    // This tests nested let bindings
    const ast = {
      tag: 'app',
      func: {
        tag: 'lam',
        param: 'c',
        body: {
          tag: 'app',
          func: {
            tag: 'lam',
            param: 'x',
            body: { tag: 'var', name: 'x' }
          },
          arg: {
            // Inner let: let b = c in b
            tag: 'app',
            func: {
              tag: 'lam',
              param: 'b',
              body: { tag: 'var', name: 'b' }
            },
            arg: { tag: 'var', name: 'c' }
          }
        }
      },
      arg: { tag: 'con', value: { tag: 'integer', value: 42n } }
    };
    
    const structure: ContractStructure = {
      type: 'spend',
      params: [],
      datum: { isUsed: false, fields: [] },
      redeemer: { variants: [] },
      checks: [],
      rawBody: ast,
      fullAst: ast,
      utilityBindings: {}
    };
    
    const result = generateValidator(structure);
    const content = result.validator.handlers[0].body.content;
    console.log('Nested let output:', content);
    
    // Should resolve to 42
    expect(content).toBe('42');
  });
});
