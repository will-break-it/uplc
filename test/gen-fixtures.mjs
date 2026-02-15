import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = '/Users/will/Workspace/web/uplc';
const FIXTURES_DIR = join(ROOT, 'test/fixtures/cbor');

function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function stripCborWrapper(cbor) {
  if (cbor.startsWith('59')) return cbor.slice(6);
  if (cbor.startsWith('58')) return cbor.slice(4);
  if (cbor.startsWith('5a')) return cbor.slice(10);
  return cbor;
}

const { UPLCDecoder } = await import('@harmoniclabs/uplc');
const { convertFromHarmoniclabs } = await import(join(ROOT, 'packages/parser/dist/index.js'));
const { analyzeContract } = await import(join(ROOT, 'packages/patterns/dist/index.js'));
const { generate } = await import(join(ROOT, 'packages/codegen/dist/index.js'));

const AIKEN_TOML = `name = "uplc/fixture"
version = "0.0.0"
plutus = "v3"

[[dependencies]]
name = "aiken-lang/stdlib"
version = "v2"
source = "github"
`;

const targets = ['2ed2631d', 'da5b47ae', 'ea184d0a', '1632c998', '6b9c456a'];

const fixtures = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));

for (const target of targets) {
  const full = fixtures.find(f => f.startsWith(target));
  if (!full) { console.log('NOT FOUND: ' + target); continue; }
  
  const data = JSON.parse(readFileSync(join(FIXTURES_DIR, full + '.json'), 'utf-8'));
  const inner = stripCborWrapper(data.cbor);
  const buffer = hexToBuffer(inner);
  const program = UPLCDecoder.parse(buffer, 'flat');
  const ast = convertFromHarmoniclabs(program.body);
  const structure = analyzeContract(ast);
  const code = generate(structure);

  const tmpDir = '/tmp/aiken-detail-' + target;
  mkdirSync(join(tmpDir, 'validators'), { recursive: true });
  writeFileSync(join(tmpDir, 'aiken.toml'), AIKEN_TOML);
  writeFileSync(join(tmpDir, 'validators/decompiled.ak'), code);
  writeFileSync('/tmp/aiken-detail-' + target + '.ak', code);
  
  console.log('Generated: ' + target + ' -> ' + tmpDir);
}
console.log('DONE');
