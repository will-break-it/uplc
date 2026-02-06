import type { UplcTerm } from '@uplc/parser';
import type { ValidationCheck } from './types.js';

/**
 * Common builtins and their categories
 */
const BUILTIN_CATEGORIES: Record<string, ValidationCheck['type']> = {
  'verifyEd25519Signature': 'signature',
  'verifyEcdsaSecp256k1Signature': 'signature',
  'verifySchnorrSecp256k1Signature': 'signature',
  'equalsByteString': 'equality',
  'equalsInteger': 'equality',
  'equalsString': 'equality',
  'equalsData': 'equality',
  'lessThanInteger': 'comparison',
  'lessThanEqualsInteger': 'comparison',
  'lessThanByteString': 'comparison',
  'lessThanEqualsByteString': 'comparison',
};

/**
 * Detect validation checks in the contract body
 */
export function detectChecks(body: UplcTerm): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  findChecks(body, checks);
  return checks;
}

function findChecks(term: UplcTerm, checks: ValidationCheck[]): void {
  switch (term.tag) {
    case 'builtin': {
      const type = BUILTIN_CATEGORIES[term.name] || 'builtin_call';
      checks.push({
        type,
        builtin: term.name,
        description: describeBuiltin(term.name),
        node: term,
      });
      break;
    }
    
    case 'app':
      findChecks(term.func, checks);
      findChecks(term.arg, checks);
      break;
      
    case 'lam':
      findChecks(term.body, checks);
      break;
      
    case 'force':
    case 'delay':
      findChecks(term.term, checks);
      break;
  }
}

function describeBuiltin(name: string): string {
  switch (name) {
    case 'verifyEd25519Signature':
      return 'Ed25519 signature verification';
    case 'verifyEcdsaSecp256k1Signature':
      return 'ECDSA secp256k1 signature verification';
    case 'verifySchnorrSecp256k1Signature':
      return 'Schnorr secp256k1 signature verification';
    case 'equalsByteString':
      return 'ByteString equality check';
    case 'equalsInteger':
      return 'Integer equality check';
    case 'equalsData':
      return 'Data equality check';
    case 'lessThanInteger':
      return 'Integer less-than comparison';
    case 'lessThanEqualsInteger':
      return 'Integer less-than-or-equals comparison';
    case 'addInteger':
      return 'Integer addition';
    case 'subtractInteger':
      return 'Integer subtraction';
    case 'multiplyInteger':
      return 'Integer multiplication';
    case 'divideInteger':
      return 'Integer division';
    case 'sha2_256':
      return 'SHA2-256 hash';
    case 'sha3_256':
      return 'SHA3-256 hash';
    case 'blake2b_256':
      return 'Blake2b-256 hash';
    default:
      return `Builtin: ${name}`;
  }
}
