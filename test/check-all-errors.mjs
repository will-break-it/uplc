import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { UPLCDecoder } from '@harmoniclabs/uplc';
import { convertFromHarmoniclabs } from '@uplc/parser';
import { analyzeContract } from '@uplc/patterns';
import { generate } from '@uplc/codegen';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = '/Users/will/Workspace/web/uplc/test/fixtures/cbor';

function hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  return bytes;
}
function stripCborWrapper(cbor) {
  if (cbor.startsWith('59')) return cbor.slice(6);
  if (cbor.startsWith('58')) return cbor.slice(4);
  if (cbor.startsWith('5a')) return cbor.slice(10);
  return cbor;
}

const fixtures = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')).sort();

for (const hash of fixtures) {
  const data = JSON.parse(readFileSync(join(FIXTURES_DIR, `${hash}.json`), 'utf-8'));
  const cbor = data.cbor;
  const inner = stripCborWrapper(cbor);
  const buffer = hexToBuffer(inner);
  const program = UPLCDecoder.parse(buffer, 'flat');
  const ast = convertFromHarmoniclabs(program.body);
  const structure = analyzeContract(ast);
  const code = generate(structure);

  const tmpDir = `/tmp/aiken-check-${hash.slice(0, 8)}`;
  const validatorsDir = join(tmpDir, 'validators');
  mkdirSync(validatorsDir, { recursive: true });
  writeFileSync(join(tmpDir, 'aiken.toml'), `name = "uplc/fixture"\nversion = "0.0.0"\nplutus = "v3"\n\n[[dependencies]]\nname = "aiken-lang/stdlib"\nversion = "v2"\nsource = "github"\n`);
  writeFileSync(join(validatorsDir, 'decompiled.ak'), code);

  try {
    execSync('aiken build 2>&1', { cwd: tmpDir, timeout: 60000, stdio: 'pipe', encoding: 'utf-8' });
    console.log(`=== ${hash.slice(0,8)} === OK`);
  } catch (err) {
    const output = err.stdout || err.stderr || err.message || '';
    console.log(`=== ${hash.slice(0,8)} === FAIL`);
    console.log(output.slice(0, 600));
  }
  rmSync(tmpDir, { recursive: true, force: true });
  console.log('');
}
