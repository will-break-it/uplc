import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { UPLCDecoder } from '@harmoniclabs/uplc';
import { convertFromHarmoniclabs } from '@uplc/parser';
import { analyzeContract } from '@uplc/patterns';
import { generate } from '@uplc/codegen';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hash = process.argv[2];
const FIXTURES_DIR = join(__dirname, 'fixtures', 'cbor');

const data = JSON.parse(readFileSync(join(FIXTURES_DIR, `${hash}.json`), 'utf-8'));
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
console.log(code);
