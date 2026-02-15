import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = '/Users/will/Workspace/web/uplc';
const { UPLCDecoder } = await import('@harmoniclabs/uplc');
const { convertFromHarmoniclabs } = await import(join(ROOT, 'packages/parser/dist/index.js'));
const { analyzeContract } = await import(join(ROOT, 'packages/patterns/dist/index.js'));
const { generate } = await import(join(ROOT, 'packages/codegen/dist/index.js'));

const hash = "e1317b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309";
const data = JSON.parse(readFileSync(join(ROOT, 'test/fixtures/cbor', hash + '.json'), 'utf-8'));
let cbor = data.cbor;
if (cbor.startsWith('59')) cbor = cbor.slice(6);
else if (cbor.startsWith('58')) cbor = cbor.slice(4);
else if (cbor.startsWith('5a')) cbor = cbor.slice(10);

const buffer = new Uint8Array(cbor.length / 2);
for (let i = 0; i < cbor.length; i += 2) buffer[i/2] = parseInt(cbor.substring(i, i+2), 16);

const program = UPLCDecoder.parse(buffer, 'flat');
const ast = convertFromHarmoniclabs(program.body);
const structure = analyzeContract(ast);
const code = generate(structure);

// Print first 30 lines to check
const lines = code.split('\n');
for (let i = 0; i < Math.min(30, lines.length); i++) {
  console.log(`${i+1}: ${lines[i]}`);
}
console.log('...');
// Check for fail bindings
const failLines = lines.filter((l, i) => /let \w+ = (trace @"[^"]*": )?fail/.test(l));
console.log(`\nFail bindings found: ${failLines.length}`);
for (const l of failLines) console.log('  ' + l.trim());
