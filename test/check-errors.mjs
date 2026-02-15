// Run: node test/check-errors.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
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

const fixtures = readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')).sort();

// Save generated code for inspection
mkdirSync(join(ROOT, 'test/reports/generated-ak'), { recursive: true });

for (const hash of fixtures) {
  const short = hash.slice(0, 8);
  const data = JSON.parse(readFileSync(join(FIXTURES_DIR, `${hash}.json`), 'utf-8'));
  const inner = stripCborWrapper(data.cbor);
  const buffer = hexToBuffer(inner);
  const program = UPLCDecoder.parse(buffer, 'flat');
  const ast = convertFromHarmoniclabs(program.body);
  const structure = analyzeContract(ast);
  const code = generate(structure);

  // Save generated code
  writeFileSync(join(ROOT, 'test/reports/generated-ak', `${short}.ak`), code);

  const tmpDir = `/tmp/aiken-detail-${short}`;
  try {
    mkdirSync(join(tmpDir, 'validators'), { recursive: true });
    writeFileSync(join(tmpDir, 'aiken.toml'), AIKEN_TOML);
    writeFileSync(join(tmpDir, 'validators/decompiled.ak'), code);

    execSync('aiken build 2>&1', { cwd: tmpDir, timeout: 30000, encoding: 'utf-8' });
    console.log(`${short}: OK`);
  } catch(e) {
    const out = ((e.stdout || '') + (e.stderr || '') + '').replace(/\x1b\[[0-9;]*m/g, '').replace(/\]8;;[^\x1b]*\\/g, '');
    const errorCode = out.match(/\[([a-z_:]+)\]/)?.[1] || 'unknown';
    // Get the key error info - find lines with actual error content
    const lines = out.split('\n').map(l => l.trim()).filter(l => l);
    const relevant = lines.filter(l =>
      /Error |error |× |hint:|───|did you mean|not defined|expected|found|incompatible|must be|no /.test(l)
    ).slice(0, 6);
    console.log(`${short}: ${errorCode}`);
    for (const l of relevant) {
      console.log('  ' + l.slice(0, 150));
    }
    console.log('');
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}
