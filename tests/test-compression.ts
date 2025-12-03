/**
 * Minimal test for compression format verification
 */
import {
  Connection,
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  PublicKey,
} from '@solana/web3.js';
import { bn254 } from '@noble/curves/bn254';

const PROGRAM_ID = new PublicKey('5HVAz6ouCt8D9aaJsWfVxX6qw5aMDYsewsiowGD2ra2M');
const RPC_URL = 'http://localhost:8899';

// Constants
const BN254_FIELD_PRIME = BigInt('0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47');
const HALF_FIELD_PRIME = BN254_FIELD_PRIME / 2n;

// TestCompression instruction discriminator
const TEST_COMPRESSION_DISCRIMINATOR = 24;

function compressPoint(point: typeof bn254.G1.ProjectivePoint.BASE): Uint8Array {
  const affine = point.toAffine();
  const compressed = new Uint8Array(32);
  const xHex = affine.x.toString(16).padStart(64, '0');
  
  for (let i = 0; i < 32; i++) {
    compressed[i] = parseInt(xHex.substr(i * 2, 2), 16);
  }
  
  // Set PositiveY flag if y > p/2
  if (affine.y > HALF_FIELD_PRIME) {
    compressed[0] |= 0x80;
  }
  
  return compressed;
}

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Create a funded payer
  const payer = Keypair.generate();
  console.log('Requesting airdrop...');
  const airdrop = await connection.requestAirdrop(payer.publicKey, 2 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdrop);
  console.log('Airdrop confirmed');
  
  // Test with generator point (G)
  console.log('\n=== Testing Generator Point G ===');
  const G = bn254.G1.ProjectivePoint.BASE;
  const gAffine = G.toAffine();
  console.log('x:', gAffine.x.toString(16).slice(0, 20) + '...');
  console.log('y:', gAffine.y.toString(16).slice(0, 20) + '...');
  console.log('y > p/2:', gAffine.y > HALF_FIELD_PRIME);
  
  const gCompressed = compressPoint(G);
  console.log('Compressed (hex):', Buffer.from(gCompressed).toString('hex'));
  
  // Build instruction
  const data = Buffer.alloc(1 + 32);
  data[0] = TEST_COMPRESSION_DISCRIMINATOR;
  Buffer.from(gCompressed).copy(data, 1);
  
  const ix = new TransactionInstruction({
    keys: [],
    programId: PROGRAM_ID,
    data,
  });
  
  try {
    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      commitment: 'confirmed',
    });
    console.log('SUCCESS! Signature:', sig);
  } catch (error: any) {
    console.log('FAILED:', error.message);
    if (error.logs) {
      console.log('Logs:', error.logs);
    }
  }
  
  // Test with G*3 (has y > p/2)
  console.log('\n=== Testing Point G*3 (y > p/2) ===');
  const G3 = G.multiply(3n);
  const g3Affine = G3.toAffine();
  console.log('x:', g3Affine.x.toString(16).slice(0, 20) + '...');
  console.log('y:', g3Affine.y.toString(16).slice(0, 20) + '...');
  console.log('y > p/2:', g3Affine.y > HALF_FIELD_PRIME);
  
  const g3Compressed = compressPoint(G3);
  console.log('Compressed (hex):', Buffer.from(g3Compressed).toString('hex'));
  console.log('Byte 0:', g3Compressed[0].toString(16).padStart(2, '0'));
  
  // Build instruction
  const data3 = Buffer.alloc(1 + 32);
  data3[0] = TEST_COMPRESSION_DISCRIMINATOR;
  Buffer.from(g3Compressed).copy(data3, 1);
  
  const ix3 = new TransactionInstruction({
    keys: [],
    programId: PROGRAM_ID,
    data: data3,
  });
  
  try {
    const tx3 = new Transaction().add(ix3);
    const sig3 = await sendAndConfirmTransaction(connection, tx3, [payer], {
      commitment: 'confirmed',
    });
    console.log('SUCCESS! Signature:', sig3);
  } catch (error: any) {
    console.log('FAILED:', error.message);
    if (error.logs) {
      console.log('Logs:', error.logs);
    }
  }
}

main().catch(console.error);
