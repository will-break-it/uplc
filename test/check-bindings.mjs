import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FIXTURES_DIR = join(ROOT, 'test/fixtures/cbor');

const { UPLCDecoder } = await import('@harmoniclabs/uplc');
const { convertFromHarmoniclabs } = await import(join(ROOT, 'packages/parser/dist/index.js'));
const { analyzeContract } = await import(join(ROOT, 'packages/patterns/dist/index.js'));
const { BindingEnvironment } = await import(join(ROOT, 'packages/codegen/dist/bindings.js'));

function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}
function stripCborWrapper(cbor) {
  if (cbor.startsWith('59')) return cbor.slice(6);
  if (cbor.startsWith('58')) return cbor.slice(4);
  if (cbor.startsWith('5a')) return cbor.slice(10);
  return cbor;
}

const hash = process.argv[2] || 'eaeeb671';
const fullHash = readdirSync(FIXTURES_DIR).find(f => f.startsWith(hash))?.replace('.json', '');
if (!fullHash) { console.error('Not found:', hash); process.exit(1); }

const data = JSON.parse(readFileSync(join(FIXTURES_DIR, fullHash + '.json'), 'utf-8'));
const inner = stripCborWrapper(data.cbor);
const buffer = hexToBuffer(inner);
const program = UPLCDecoder.parse(buffer, 'flat');
const ast = convertFromHarmoniclabs(program.body);
const structure = analyzeContract(ast);

console.log('Type:', structure.type);
console.log('Params:', structure.validatorParams?.map(p => p.name));

// Build binding env
const env = new BindingEnvironment(structure.fullAst || structure.body);
// Check specific variables
for (const name of ['j', 'k', 'h', 'i', 'e', 's', 'c1']) {
  const resolved = env.get(name);
  if (resolved) {
    console.log(`${name}: ${resolved.category} pattern=${resolved.pattern} semantic=${resolved.semanticName || 'none'}`);
  }
}

// Print first few bindings
console.log('\nAll bindings:');
const allBindings = env.getAllBindings?.() || [];
for (const b of allBindings.slice(0, 20)) {
  console.log(`  ${b.name}: ${b.category} pattern=${b.pattern} sem=${b.semanticName || '-'}`);
}
