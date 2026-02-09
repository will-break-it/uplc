import { describe, it } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { UPLCDecoder } from '@harmoniclabs/uplc';
import { convertFromHarmoniclabs } from '@uplc/parser';
import { analyzeContract } from '@uplc/patterns';
import { generate } from '@uplc/codegen';

const __dirname = dirname(fileURLToPath(import.meta.url));

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function stripCborWrapper(cbor: string): string {
  if (cbor.startsWith('59')) return cbor.slice(6);
  if (cbor.startsWith('58')) return cbor.slice(4);
  if (cbor.startsWith('5a')) return cbor.slice(10);
  return cbor;
}

function decompile(cbor: string) {
  const innerHex = stripCborWrapper(cbor);
  const buffer = hexToBuffer(innerHex);
  const program = UPLCDecoder.parse(buffer, "flat");
  const ast = convertFromHarmoniclabs(program.body);
  const structure = analyzeContract(ast);
  const code = generate(structure);
  return { ast, structure, code };
}

describe('Output Sample - Decompiled Contracts', () => {
  it('Minswap V2 Authen (minting policy)', () => {
    const cbor = readFileSync(join(__dirname, '../fixtures/mainnet/minswap-v2-authen.cbor'), 'utf-8').trim();
    const { code } = decompile(cbor);
    console.log('\n=== MINSWAP V2 AUTHEN MINTING ===');
    console.log(`Code length: ${code.length} chars\n`);
    console.log(code);
  });
  
  it('JPG Store V3 Ask (spend validator)', () => {
    const cbor = readFileSync(join(__dirname, '../fixtures/mainnet/jpg-store-v3-ask.cbor'), 'utf-8').trim();
    const { code } = decompile(cbor);
    console.log('\n=== JPG STORE V3 ASK ===');
    console.log(`Code length: ${code.length} chars\n`);
    console.log(code);
  });
  
  it('SundaeSwap V3 Order (minting policy)', () => {
    const cbor = readFileSync(join(__dirname, '../fixtures/mainnet/sundaeswap-v3-order.cbor'), 'utf-8').trim();
    const { code } = decompile(cbor);
    console.log('\n=== SUNDAESWAP V3 ORDER ===');
    console.log(`Code length: ${code.length} chars\n`);
    console.log(code);
  });
});
