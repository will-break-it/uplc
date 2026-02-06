/**
 * Generate test fixtures from Aiken compiled contracts
 * 
 * Reads plutus.json from Aiken build and extracts UPLC AST for each validator
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { UPLCDecoder } from '@blaze-cardano/uplc';

interface AikenValidator {
  title: string;
  compiledCode: string;
  hash: string;
  datum?: { title: string };
  redeemer?: { title: string; schema?: { $ref?: string } };
}

interface AikenBlueprint {
  preamble: {
    title: string;
    plutusVersion: string;
  };
  validators: AikenValidator[];
  definitions: Record<string, any>;
}

interface Fixture {
  name: string;
  hash: string;
  source: string;
  cbor: string;
  ast: any;
  redeemer?: {
    variants: Array<{ title: string; index: number; fields: string[] }>;
  };
}

function stripCborWrapper(hex: string): string {
  // CBOR bytestring encoding: 58 xx (1-byte length) or 59 xx xx (2-byte) or 5a xx xx xx xx (4-byte)
  if (hex.startsWith('58')) {
    return hex.slice(4);
  } else if (hex.startsWith('59')) {
    return hex.slice(6);
  } else if (hex.startsWith('5a')) {
    return hex.slice(10);
  }
  return hex;
}

function decodeUplc(cbor: string): any {
  const innerHex = stripCborWrapper(cbor);
  const bytes = Uint8Array.from(Buffer.from(innerHex, 'hex'));
  const decoder = new UPLCDecoder(bytes);
  return decoder.decode();
}

function extractRedeemerSchema(blueprint: AikenBlueprint, validator: AikenValidator): Fixture['redeemer'] | undefined {
  const ref = validator.redeemer?.schema?.$ref;
  if (!ref) return undefined;
  
  const defName = ref.replace('#/definitions/', '');
  const def = blueprint.definitions[defName];
  if (!def?.anyOf) return undefined;
  
  return {
    variants: def.anyOf.map((v: any) => ({
      title: v.title,
      index: v.index,
      fields: (v.fields || []).map((f: any) => f.title || f.$ref?.split('/').pop() || 'unknown'),
    })),
  };
}

async function main() {
  // Read plutus.json
  const blueprint: AikenBlueprint = JSON.parse(
    readFileSync('./fixtures/fixtures/plutus.json', 'utf-8')
  );
  
  console.log(`Found ${blueprint.validators.length} validators`);
  console.log(`Plutus version: ${blueprint.preamble.plutusVersion}`);
  
  // Create output directory
  mkdirSync('./fixtures/generated', { recursive: true });
  
  const fixtures: Record<string, Fixture> = {};
  
  for (const validator of blueprint.validators) {
    // Skip the "else" handlers - focus on "spend"
    if (validator.title.endsWith('.else')) continue;
    
    const name = validator.title.split('.')[0]; // e.g., "always_true"
    const cbor = validator.compiledCode;
    
    try {
      // Decode UPLC
      const decoded = decodeUplc(cbor);
      
      // Read source
      let source = '';
      try {
        source = readFileSync(`./fixtures/fixtures/validators/${name}.ak`, 'utf-8');
      } catch {}
      
      // Extract redeemer schema from blueprint
      const redeemer = extractRedeemerSchema(blueprint, validator);
      
      fixtures[name] = {
        name,
        hash: validator.hash,
        source,
        cbor,
        ast: decoded,
        redeemer,
      };
      
      console.log(`✓ ${name}: ${validator.hash.slice(0, 16)}... (v${decoded.version})`);
      if (redeemer) {
        console.log(`  └─ Redeemer variants: ${redeemer.variants.map(v => v.title).join(', ')}`);
      }
    } catch (err) {
      console.error(`✗ ${name}: ${err}`);
    }
  }
  
  // Write fixtures
  writeFileSync(
    './fixtures/generated/fixtures.json',
    JSON.stringify(fixtures, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2)
  );
  
  console.log(`\nGenerated ${Object.keys(fixtures).length} fixtures`);
}

main().catch(console.error);
