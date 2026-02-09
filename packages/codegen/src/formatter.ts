/**
 * Code Formatter - GeneratedCode → String
 */

import type { 
  GeneratedCode, 
  ValidatorBlock, 
  HandlerBlock, 
  CodeBlock,
  TypeDefinition,
  ParameterInfo 
} from './types.js';

const INDENT = '  ';

/**
 * Format generated code into a string
 */
export function formatCode(code: GeneratedCode): string {
  const parts: string[] = [];
  
  // Format imports first
  if (code.imports && code.imports.length > 0) {
    for (const mod of code.imports) {
      parts.push(`use ${mod}`);
    }
    parts.push('');
  }
  
  // Format script-level parameters (hardcoded constants)
  if (code.scriptParams && code.scriptParams.length > 0) {
    parts.push('// Script parameters (hardcoded constants)');
    for (const param of code.scriptParams) {
      if (param.type === 'bytestring') {
        parts.push(`const ${param.name} = #"${param.value}"`);
      } else {
        parts.push(`const ${param.name} = ${param.value}`);
      }
    }
    parts.push('');
  }
  
  // Format type definitions
  for (const type of code.types) {
    parts.push(formatType(type));
    parts.push('');
  }
  
  // Format validator
  parts.push(formatValidator(code.validator));
  
  return parts.join('\n');
}

/**
 * Format a type definition
 */
function formatType(type: TypeDefinition): string {
  if (type.kind === 'enum') {
    const variants = type.variants?.map(v => {
      if (v.fields && v.fields.length > 0) {
        const fields = v.fields.map(f => `${f.name}: ${f.type}`).join(', ');
        return `${INDENT}${v.name} { ${fields} }`;
      }
      return `${INDENT}${v.name}`;
    }).join('\n');
    
    return `type ${type.name} {\n${variants}\n}`;
  }
  
  // Struct
  const fields = type.fields?.map(f => `${INDENT}${f.name}: ${f.type},`).join('\n');
  return `type ${type.name} {\n${fields}\n}`;
}

/**
 * Format a validator block
 */
function formatValidator(validator: ValidatorBlock): string {
  const params = validator.params.length > 0
    ? `(${validator.params.map(formatParam).join(', ')})`
    : '';
    
  const handlers = validator.handlers.map(h => formatHandler(h, 1)).join('\n\n');
  
  return `validator ${validator.name}${params} {\n${handlers}\n}`;
}

/**
 * Format a handler block
 */
function formatHandler(handler: HandlerBlock, level: number): string {
  const indent = INDENT.repeat(level);
  const params = handler.params.map(formatParam).join(', ');
  const body = formatCodeBlock(handler.body, level + 1);
  
  return `${indent}${handler.kind}(${params}) {\n${body}\n${indent}}`;
}

/**
 * Format a parameter
 */
function formatParam(param: ParameterInfo): string {
  const optional = param.isOptional ? 'Option<' : '';
  const optionalClose = param.isOptional ? '>' : '';
  
  if (param.type.startsWith('Option<')) {
    return `${param.name}: ${param.type}`;
  }
  
  return `${param.name}: ${optional}${param.type}${optionalClose}`;
}

/**
 * Format a code block
 */
function formatCodeBlock(block: CodeBlock, level: number): string {
  const indent = INDENT.repeat(level);
  
  switch (block.kind) {
    case 'when':
      return formatWhen(block, level);
    case 'if':
      return formatIf(block, level);
    case 'let':
    case 'expect':
      return `${indent}${block.kind} ${block.content}`;
    case 'expression':
      return `${indent}${block.content}`;
    case 'block':
      if (Array.isArray(block.content)) {
        return block.content.map(b => formatCodeBlock(b, level)).join('\n');
      }
      return `${indent}${block.content}`;
    default:
      return `${indent}${block.content}`;
  }
}

/**
 * Format a when expression
 */
function formatWhen(block: CodeBlock, level: number): string {
  const indent = INDENT.repeat(level);
  const branches = block.branches?.map(b => {
    const branchIndent = INDENT.repeat(level + 1);
    const body = formatCodeBlock(b.body, level + 2).trim();
    return `${branchIndent}${b.pattern} -> ${body}`;
  }).join('\n');
  
  return `${indent}when ${block.content} is {\n${branches}\n${indent}}`;
}

/**
 * Format an if expression
 */
function formatIf(block: CodeBlock, level: number): string {
  const indent = INDENT.repeat(level);
  const condition = block.condition || 'condition';
  const body = formatCodeBlock(block.branches?.[0]?.body || { kind: 'expression', content: 'True' }, level + 1);
  
  let result = `${indent}if ${condition} {\n${body}\n${indent}}`;
  
  if (block.branches && block.branches.length > 1) {
    const elseBody = formatCodeBlock(block.branches[1].body, level + 1);
    result += ` else {\n${elseBody}\n${indent}}`;
  }
  
  return result;
}
