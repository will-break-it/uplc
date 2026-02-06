#!/usr/bin/env npx tsx
/**
 * Extract UPLC from compiled Aiken validators
 * Outputs JSON test fixtures for the decompiler
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// @ts-ignore - We'll use dynamic import for the UPLC decoder
const __dirname = dirname(fileURLToPath(import.meta.url));

interface Validator {
  title: string;
  compiledCode: string;
  hash: string;
  datum?: { title: string };
  redeemer?: { title: string };
}

interface Blueprint {
  preamble: { title: string; version: string };
  validators: Validator[];
}

async function main() {
  // Read blueprint
  const blueprintPath = join(__dirname, 'plutus.json');
  const blueprint: Blueprint = JSON.parse(readFileSync(blueprintPath, 'utf-8'));
  
  console.log(`Found ${blueprint.validators.length} validators in ${blueprint.preamble.title}`);
  
  // Create output directory
  const outDir = join(__dirname, 'uplc');
  mkdirSync(outDir, { recursive: true });
  
  // Extract each validator
  const fixtures: Record<string, { title: string; cbor: string; hash: string }> = {};
  
  for (const validator of blueprint.validators) {
    // Skip fallback handlers for now
    if (validator.title.endsWith('.else')) continue;
    
    const name = validator.title.replace(/\./g, '_');
    fixtures[name] = {
      title: validator.title,
      cbor: validator.compiledCode,
      hash: validator.hash
    };
    
    console.log(`  - ${validator.title} (${validator.compiledCode.length / 2} bytes)`);
  }
  
  // Write fixtures
  const fixturesPath = join(outDir, 'fixtures.json');
  writeFileSync(fixturesPath, JSON.stringify(fixtures, null, 2));
  console.log(`\nWrote ${Object.keys(fixtures).length} fixtures to ${fixturesPath}`);
}

main().catch(console.error);
