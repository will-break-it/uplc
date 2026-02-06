/**
 * Common Contract Pattern Detection
 *
 * Detects well-known patterns in validators:
 * - Timelock checks
 * - Signature verification
 * - Value conservation
 * - NFT authentication
 */

import type { UplcTerm } from '@uplc/parser';
import { flattenApp, getBuiltinName, referencesVar } from './traversal.js';

export interface PatternMatch {
  kind: string;
  description: string;
  confidence: number;
  location: UplcTerm;
}

/**
 * Detect all common patterns in a validator
 */
export function detectCommonPatterns(body: UplcTerm, contextParam?: string): PatternMatch[] {
  const patterns: PatternMatch[] = [];

  patterns.push(...detectTimelockPattern(body, contextParam));
  patterns.push(...detectSignaturePattern(body, contextParam));
  patterns.push(...detectValuePattern(body, contextParam));
  patterns.push(...detectNFTPattern(body));

  return patterns;
}

/**
 * Detect timelock/deadline checks
 * Pattern: checking tx.validity_range against a deadline
 */
function detectTimelockPattern(term: UplcTerm, contextParam?: string): PatternMatch[] {
  const matches: PatternMatch[] = [];

  // Look for lessThan/greaterThan comparisons
  findTimelockChecks(term, contextParam, matches);

  return matches;
}

function findTimelockChecks(term: UplcTerm, contextParam: string | undefined, matches: PatternMatch[]): void {
  if (term.tag === 'app') {
    const parts = flattenApp(term);
    const builtin = getBuiltinName(parts[0]);

    if (builtin === 'lessThanInteger' || builtin === 'lessThanEqualsInteger') {
      // Check if one arg references context (validity range)
      const hasContextRef = contextParam && parts.slice(1).some(arg => referencesVar(arg, contextParam));
      if (hasContextRef) {
        matches.push({
          kind: 'timelock',
          description: 'Deadline check using tx validity range',
          confidence: 0.8,
          location: term
        });
      }
    }

    findTimelockChecks(term.func, contextParam, matches);
    findTimelockChecks(term.arg, contextParam, matches);
  } else if (term.tag === 'lam') {
    findTimelockChecks(term.body, contextParam, matches);
  }
}

/**
 * Detect signature verification patterns
 */
function detectSignaturePattern(term: UplcTerm, contextParam?: string): PatternMatch[] {
  const matches: PatternMatch[] = [];

  findSignatureChecks(term, matches);

  return matches;
}

function findSignatureChecks(term: UplcTerm, matches: PatternMatch[]): void {
  if (term.tag === 'app') {
    const parts = flattenApp(term);
    const builtin = getBuiltinName(parts[0]);

    if (builtin === 'verifyEd25519Signature' ||
        builtin === 'verifyEcdsaSecp256k1Signature' ||
        builtin === 'verifySchnorrSecp256k1Signature') {
      matches.push({
        kind: 'signature',
        description: `Cryptographic signature verification (${builtin})`,
        confidence: 1.0,
        location: term
      });
    }

    // Also check for list.has(tx.extra_signatories, ...)
    if (builtin === 'elem' || builtin === 'any') {
      matches.push({
        kind: 'signature',
        description: 'Check required signer in tx.extra_signatories',
        confidence: 0.7,
        location: term
      });
    }

    findSignatureChecks(term.func, matches);
    findSignatureChecks(term.arg, matches);
  } else if (term.tag === 'lam') {
    findSignatureChecks(term.body, matches);
  }
}

/**
 * Detect value conservation checks
 */
function detectValuePattern(term: UplcTerm, contextParam?: string): PatternMatch[] {
  const matches: PatternMatch[] = [];

  findValueChecks(term, matches);

  return matches;
}

function findValueChecks(term: UplcTerm, matches: PatternMatch[]): void {
  if (term.tag === 'app') {
    const parts = flattenApp(term);
    const builtin = getBuiltinName(parts[0]);

    // Look for value operations
    if (builtin === 'addInteger' || builtin === 'subtractInteger') {
      // If used in comparison context, likely value check
      matches.push({
        kind: 'value',
        description: 'Value calculation (likely checking ADA amounts)',
        confidence: 0.6,
        location: term
      });
    }

    findValueChecks(term.func, matches);
    findValueChecks(term.arg, matches);
  } else if (term.tag === 'lam') {
    findValueChecks(term.body, matches);
  }
}

/**
 * Detect NFT authentication patterns
 */
function detectNFTPattern(term: UplcTerm): PatternMatch[] {
  const matches: PatternMatch[] = [];

  findNFTChecks(term, matches);

  return matches;
}

function findNFTChecks(term: UplcTerm, matches: PatternMatch[]): void {
  if (term.tag === 'app') {
    const parts = flattenApp(term);
    const builtin = getBuiltinName(parts[0]);

    // NFTs often check for specific token names or policy IDs
    if (builtin === 'equalsByteString' && parts.length >= 3) {
      // Check if one arg is a constant (policy ID or token name)
      const hasConstant = parts.some(part => part.tag === 'con' && part.type === 'bytestring');
      if (hasConstant) {
        matches.push({
          kind: 'nft',
          description: 'NFT authentication (checking policy ID or token name)',
          confidence: 0.7,
          location: term
        });
      }
    }

    findNFTChecks(term.func, matches);
    findNFTChecks(term.arg, matches);
  } else if (term.tag === 'lam') {
    findNFTChecks(term.body, matches);
  }
}
