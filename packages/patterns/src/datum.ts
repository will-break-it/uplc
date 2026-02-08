/**
 * Datum Pattern Detection
 * 
 * Analyzes how the datum parameter is used in spend validators:
 * - Whether datum is actually used or ignored
 * - What fields are accessed from the datum
 * - Inferred datum structure with type inference
 */
import type { UplcTerm } from '@uplc/parser';
import type { DatumInfo, FieldInfo } from './types.js';
import { findAll, getBuiltinName, referencesVar, flattenApp } from './traversal.js';

/**
 * Analyze datum usage in a validator body
 */
export function analyzeDatum(body: UplcTerm, datumParam: string | undefined): DatumInfo {
  if (!datumParam) {
    return {
      isUsed: false,
      isOptional: true,
      fields: [],
      inferredType: 'unknown'
    };
  }
  
  // Check if datum is referenced at all
  const isUsed = referencesVar(body, datumParam);
  
  if (!isUsed) {
    return {
      isUsed: false,
      isOptional: true,
      fields: [],
      inferredType: 'unit'  // Unused datum is effectively unit
    };
  }
  
  // Find datum field accesses with type inference
  const fields = extractDatumFields(body, datumParam);
  
  // Infer type based on usage
  const inferredType = fields.length > 0 ? 'custom' : 'unknown';
  
  return {
    isUsed: true,
    isOptional: false,  // If used, we expect it to be present
    fields,
    inferredType
  };
}

/**
 * Infer the type of a field access based on how it's used
 */
function inferFieldType(body: UplcTerm, fieldAccessExpr: UplcTerm): string {
  // Look for type-revealing builtins applied to this expression
  // Track what builtins are applied to track down the expression
  
  const typeHints = findAll(body, term => {
    if (term.tag !== 'app') return false;
    const parts = flattenApp(term);
    const builtin = getBuiltinName(parts[0]);
    
    // Check if this builtin operates on our field expression
    if (parts.length < 2) return false;
    
    // Type-revealing builtins
    if (['unIData', 'unBData', 'unListData', 'unMapData'].includes(builtin || '')) {
      return true;
    }
    
    // Comparison builtins reveal types
    if (['equalsInteger', 'lessThanInteger', 'lessThanEqualsInteger'].includes(builtin || '')) {
      return true;
    }
    if (['equalsByteString', 'lessThanByteString'].includes(builtin || '')) {
      return true;
    }
    
    return false;
  });
  
  // Default to unknown
  if (typeHints.length === 0) return 'unknown';
  
  // Check the first type hint
  const hint = typeHints[0];
  if (hint.tag !== 'app') return 'unknown';
  
  const parts = flattenApp(hint);
  const builtin = getBuiltinName(parts[0]);
  
  switch (builtin) {
    case 'unIData':
    case 'equalsInteger':
    case 'lessThanInteger':
    case 'lessThanEqualsInteger':
    case 'addInteger':
    case 'subtractInteger':
    case 'multiplyInteger':
      return 'integer';
      
    case 'unBData':
    case 'equalsByteString':
    case 'lessThanByteString':
    case 'lengthOfByteString':
      return 'bytestring';
      
    case 'unListData':
      return 'list';
      
    case 'unMapData':
      return 'map';
      
    default:
      return 'unknown';
  }
}

/**
 * Extract fields accessed from the datum
 * 
 * Pattern: headList(tailList^n(sndPair(unConstrData(datum))))
 */
function extractDatumFields(term: UplcTerm, datumParam: string): FieldInfo[] {
  const fields: FieldInfo[] = [];
  const seenIndices = new Set<number>();
  
  // Find all unConstrData applications on the datum
  const unConstrApps = findAll(term, t => {
    if (t.tag !== 'app') return false;
    const parts = flattenApp(t);
    const builtin = getBuiltinName(parts[0]);
    if (builtin !== 'unConstrData') return false;
    if (parts.length < 2) return false;
    return referencesVar(parts[1], datumParam);
  });
  
  // For each unConstrData(datum), find field accesses
  for (const unConstrApp of unConstrApps) {
    // Find headList applications that use sndPair of this unConstrData
    const headListApps = findAll(term, t => {
      if (t.tag !== 'app') return false;
      return getBuiltinName(t.func) === 'headList';
    });
    
    for (const headApp of headListApps) {
      if (headApp.tag !== 'app') continue;
      
      const fieldIndex = measureDatumFieldDepth(headApp.arg, datumParam);
      if (fieldIndex !== undefined && !seenIndices.has(fieldIndex)) {
        seenIndices.add(fieldIndex);
        fields.push({
          index: fieldIndex,
          accessPattern: fieldIndex === 0 
            ? 'datum.field_0' 
            : `datum.field_${fieldIndex}`,
          inferredType: 'unknown'
        });
      }
    }
  }
  
  // Sort by field index
  fields.sort((a, b) => a.index - b.index);
  
  return fields;
}

/**
 * Measure the tail depth to determine datum field index
 * 
 * sndPair(unConstrData(datum)) -> field 0
 * tailList(sndPair(unConstrData(datum))) -> field 1
 * tailList(tailList(sndPair(unConstrData(datum)))) -> field 2
 */
function measureDatumFieldDepth(term: UplcTerm, datumParam: string): number | undefined {
  let depth = 0;
  let current = term;
  
  while (true) {
    const parts = flattenApp(current);
    const builtinName = getBuiltinName(parts[0]);
    
    if (builtinName === 'tailList') {
      depth++;
      if (parts.length < 2) return undefined;
      current = parts[1];
    } else if (builtinName === 'sndPair') {
      // Check if this is sndPair(unConstrData(datumParam))
      if (parts.length < 2) return undefined;
      const innerParts = flattenApp(parts[1]);
      const innerBuiltin = getBuiltinName(innerParts[0]);
      if (innerBuiltin === 'unConstrData' && innerParts.length >= 2) {
        if (referencesVar(innerParts[1], datumParam)) {
          return depth;
        }
      }
      return undefined;
    } else {
      return undefined;
    }
  }
}
