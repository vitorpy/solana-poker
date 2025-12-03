/**
 * Compression Format Verification Test
 *
 * Tests that our client-side compression matches what Solana's decompression expects.
 */

import {
  startValidator,
  stopValidator,
  getConnection,
  getProgramId,
  createFundedPayer,
} from '../helpers/validator';
import {
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  Keypair,
} from '@solana/web3.js';
import { bn254 } from '@noble/curves/bn254';

// Constants
const BN254_FIELD_PRIME = BigInt('0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47');
const HALF_FIELD_PRIME = BN254_FIELD_PRIME / 2n;
const TEST_COMPRESSION_DISCRIMINATOR = 24;

function compressPoint(point: typeof bn254.G1.ProjectivePoint.BASE): Uint8Array {
  const affine = point.toAffine();
  const compressed = new Uint8Array(32);
  const xHex = affine.x.toString(16).padStart(64, '0');

  // Solana expects BIG-ENDIAN format
  for (let i = 0; i < 32; i++) {
    compressed[i] = parseInt(xHex.substr(i * 2, 2), 16);
  }

  // Set PositiveY flag on the FIRST byte (MSB in BE format)
  if (affine.y > HALF_FIELD_PRIME) {
    compressed[0] |= 0x80;
  }

  return compressed;
}

function pointToBytes(point: typeof bn254.G1.ProjectivePoint.BASE): Uint8Array {
  const affine = point.toAffine();
  const bytes = new Uint8Array(64);
  const xHex = affine.x.toString(16).padStart(64, '0');
  const yHex = affine.y.toString(16).padStart(64, '0');

  // Solana expects BIG-ENDIAN format
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(xHex.substr(i * 2, 2), 16);
    bytes[32 + i] = parseInt(yHex.substr(i * 2, 2), 16);
  }

  return bytes;
}

describe('Compression Format', () => {
  let payer: Keypair;

  beforeAll(async () => {
    await startValidator();
    payer = await createFundedPayer();
  }, 60000);

  afterAll(async () => {
    await stopValidator();
  });

  // Test using EXACT bytes from Solana's alt_bn128.c test
  async function testSolanaExactBytes(): Promise<boolean> {
    const connection = getConnection();
    const programId = getProgramId();

    console.log('\n=== Testing with EXACT Solana test vectors ===');

    // Exact point from Solana's multiplication test (first 64 bytes of input)
    const solanaTestPoint = new Uint8Array([
      0x2b, 0xd3, 0xe6, 0xd0, 0xf3, 0xb1, 0x42, 0x92, 0x4f, 0x5c, 0xa7, 0xb4,
      0x9c, 0xe5, 0xb9, 0xd5, 0x4c, 0x47, 0x03, 0xd7, 0xae, 0x56, 0x48, 0xe6,
      0x1d, 0x02, 0x26, 0x8b, 0x1a, 0x0a, 0x9f, 0xb7, // x
      0x21, 0x61, 0x1c, 0xe0, 0xa6, 0xaf, 0x85, 0x91, 0x5e, 0x2f, 0x1d, 0x70,
      0x30, 0x09, 0x09, 0xce, 0x2e, 0x49, 0xdf, 0xad, 0x4a, 0x46, 0x19, 0xc8,
      0x39, 0x0c, 0xae, 0x66, 0xce, 0xfd, 0xb2, 0x04  // y
    ]);

    console.log('Point x (first 8 bytes):', Buffer.from(solanaTestPoint.slice(0, 8)).toString('hex'));
    console.log('Point y (first 8 bytes):', Buffer.from(solanaTestPoint.slice(32, 40)).toString('hex'));

    // Mode 0 = direct bn254_mul test
    const data = Buffer.alloc(1 + 1 + 64);
    data[0] = TEST_COMPRESSION_DISCRIMINATOR;
    data[1] = 0; // Mode 0
    Buffer.from(solanaTestPoint).copy(data, 2);

    const ix = new TransactionInstruction({
      keys: [],
      programId,
      data,
    });

    try {
      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(connection, tx, [payer], {
        commitment: 'confirmed',
      });
      console.log('Result: SUCCESS - Solana test point works!');
      return true;
    } catch (error: any) {
      console.log('Result: FAILED');
      if (error.logs) {
        console.log('Logs:', error.logs);
      }
      return false;
    }
  }

  async function testDirectMul(point: typeof bn254.G1.ProjectivePoint.BASE, label: string): Promise<boolean> {
    const connection = getConnection();
    const programId = getProgramId();

    const affine = point.toAffine();
    console.log(`\n=== Direct bn254_mul Test: ${label} ===`);
    console.log('x:', affine.x.toString(16).slice(0, 20) + '...');
    console.log('y:', affine.y.toString(16).slice(0, 20) + '...');

    const uncompressed = pointToBytes(point);
    console.log('Uncompressed (64 bytes):', Buffer.from(uncompressed).toString('hex').slice(0, 40) + '...');

    // Mode 0 = direct bn254_mul test
    const data = Buffer.alloc(1 + 1 + 64);
    data[0] = TEST_COMPRESSION_DISCRIMINATOR;
    data[1] = 0; // Mode 0
    Buffer.from(uncompressed).copy(data, 2);

    const ix = new TransactionInstruction({
      keys: [],
      programId,
      data,
    });

    try {
      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(connection, tx, [payer], {
        commitment: 'confirmed',
      });
      console.log('Result: SUCCESS - bn254_mul works with raw point');
      return true;
    } catch (error: any) {
      console.log('Result: FAILED');
      if (error.logs) {
        console.log('Logs:', error.logs);
      }
      return false;
    }
  }

  async function testRoundTrip(point: typeof bn254.G1.ProjectivePoint.BASE, label: string): Promise<boolean> {
    const connection = getConnection();
    const programId = getProgramId();

    const affine = point.toAffine();
    console.log(`\n=== Round-trip Test: ${label} ===`);
    console.log('x:', affine.x.toString(16).slice(0, 20) + '...');
    console.log('y:', affine.y.toString(16).slice(0, 20) + '...');

    const uncompressed = pointToBytes(point);
    console.log('Uncompressed (64 bytes):', Buffer.from(uncompressed).toString('hex').slice(0, 40) + '...');

    // Mode 1 = round-trip test
    const data = Buffer.alloc(1 + 1 + 64);
    data[0] = TEST_COMPRESSION_DISCRIMINATOR;
    data[1] = 1; // Mode 1
    Buffer.from(uncompressed).copy(data, 2);

    const ix = new TransactionInstruction({
      keys: [],
      programId,
      data,
    });

    try {
      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(connection, tx, [payer], {
        commitment: 'confirmed',
      });
      console.log('Result: SUCCESS - round-trip works');
      return true;
    } catch (error: any) {
      console.log('Result: FAILED');
      if (error.logs) {
        console.log('Logs:', error.logs);
      }
      return false;
    }
  }

  async function testCompressPoint(point: typeof bn254.G1.ProjectivePoint.BASE, label: string): Promise<boolean> {
    const connection = getConnection();
    const programId = getProgramId();

    const affine = point.toAffine();
    console.log(`\n=== Testing ${label} ===`);
    console.log('x:', affine.x.toString(16).slice(0, 20) + '...');
    console.log('y:', affine.y.toString(16).slice(0, 20) + '...');
    console.log('y > p/2:', affine.y > HALF_FIELD_PRIME);

    const compressed = compressPoint(point);
    console.log('Compressed byte 0:', compressed[0].toString(16).padStart(2, '0'));
    console.log('Full compressed:', Buffer.from(compressed).toString('hex'));

    // Mode 2 = client compression test
    const data = Buffer.alloc(1 + 1 + 32);
    data[0] = TEST_COMPRESSION_DISCRIMINATOR;
    data[1] = 2; // Mode 2
    Buffer.from(compressed).copy(data, 2);

    const ix = new TransactionInstruction({
      keys: [],
      programId,
      data,
    });

    try {
      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(connection, tx, [payer], {
        commitment: 'confirmed',
      });
      console.log('Result: SUCCESS - point is valid');
      return true;
    } catch (error: any) {
      console.log('Result: FAILED');
      if (error.logs) {
        console.log('Logs:', error.logs);
      }
      return false;
    }
  }

  it('should work with Solana exact test bytes', async () => {
    const success = await testSolanaExactBytes();
    expect(success).toBe(true);
  }, 30000);

  it('should pass direct bn254_mul test with raw point', async () => {
    const G = bn254.G1.ProjectivePoint.BASE;
    const success = await testDirectMul(G, 'Generator G direct');
    expect(success).toBe(true);
  }, 30000);

  it('should pass round-trip test with Solana compress/decompress', async () => {
    const G = bn254.G1.ProjectivePoint.BASE;
    const success = await testRoundTrip(G, 'Generator G round-trip');
    expect(success).toBe(true);
  }, 30000);

  it('should handle generator point G (y < p/2)', async () => {
    const G = bn254.G1.ProjectivePoint.BASE;
    const success = await testCompressPoint(G, 'Generator G');
    expect(success).toBe(true);
  }, 30000);

  it('should handle G*2 (y < p/2)', async () => {
    const G = bn254.G1.ProjectivePoint.BASE;
    const G2 = G.multiply(2n);
    const success = await testCompressPoint(G2, 'G*2');
    expect(success).toBe(true);
  }, 30000);

  it('should handle G*3 (y > p/2, flag set)', async () => {
    const G = bn254.G1.ProjectivePoint.BASE;
    const G3 = G.multiply(3n);
    const affine = G3.toAffine();
    console.log('Verifying G*3 has y > p/2:', affine.y > HALF_FIELD_PRIME);
    expect(affine.y > HALF_FIELD_PRIME).toBe(true); // Ensure this point has the flag

    const success = await testCompressPoint(G3, 'G*3');
    expect(success).toBe(true);
  }, 30000);

  it('should handle random scalar multiplication', async () => {
    const G = bn254.G1.ProjectivePoint.BASE;
    const scalar = BigInt('0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
    const point = G.multiply(scalar);
    const success = await testCompressPoint(point, 'G*random');
    expect(success).toBe(true);
  }, 30000);
});
