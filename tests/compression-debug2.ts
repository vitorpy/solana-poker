/**
 * Debug script to find points with y > p/2 (flag would be set)
 */
import { bn254 } from '@noble/curves/bn254';

const BN254_FIELD_PRIME = BigInt('0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47');
const HALF_FIELD_PRIME = BN254_FIELD_PRIME / 2n;
const CURVE_ORDER = bn254.params.r;
const G1 = bn254.G1.ProjectivePoint.BASE;

// Test with various scalars to find one with y > p/2
let foundYBig = false;
for (let i = 1n; i < 100n; i++) {
  const point = G1.multiply(i);
  const affine = point.toAffine();
  if (affine.y > HALF_FIELD_PRIME) {
    console.log(`Found point with y > p/2 at scalar ${i}`);
    console.log('x:', affine.x.toString(16).slice(0, 20) + '...');
    console.log('y:', affine.y.toString(16).slice(0, 20) + '...');
    console.log('y > p/2:', true);
    
    // Show what compression would produce
    const compressed = new Uint8Array(32);
    const xHex = affine.x.toString(16).padStart(64, '0');
    for (let j = 0; j < 32; j++) {
      compressed[j] = parseInt(xHex.substr(j * 2, 2), 16);
    }
    compressed[0] |= 0x80; // Set flag
    console.log('compressed byte 0:', compressed[0].toString(16).padStart(2, '0'));
    console.log('full compressed:', Buffer.from(compressed).toString('hex').slice(0, 40) + '...');
    foundYBig = true;
    break;
  }
}

if (!foundYBig) {
  console.log('No point with y > p/2 found in first 100 scalars');
}

// Now simulate what happens in the test - generate accumulator-based points
console.log('\n=== Testing with simulated accumulator values ===');
import * as crypto from 'crypto';

// Generate some random 256-bit values like the shuffle vectors would
const randomVal = crypto.randomBytes(32);
const scalar = BigInt('0x' + randomVal.toString('hex')) % CURVE_ORDER;
const point = G1.multiply(scalar);
const affine = point.toAffine();

console.log('Random scalar:', scalar.toString(16).slice(0, 20) + '...');
console.log('Point x:', affine.x.toString(16).slice(0, 20) + '...');
console.log('Point y:', affine.y.toString(16).slice(0, 20) + '...');
console.log('y > p/2:', affine.y > HALF_FIELD_PRIME);

// Compress it
const compressed = new Uint8Array(32);
const xHex = affine.x.toString(16).padStart(64, '0');
for (let j = 0; j < 32; j++) {
  compressed[j] = parseInt(xHex.substr(j * 2, 2), 16);
}
if (affine.y > HALF_FIELD_PRIME) {
  compressed[0] |= 0x80;
}
console.log('Compressed byte 0:', compressed[0].toString(16).padStart(2, '0'));

// Show what decompression should produce
// After BE->LE conversion, byte[0] becomes byte[31]
// The flag in bit 7 of byte[0] becomes bit 7 of byte[31]
console.log('\n=== Simulating BE -> LE conversion ===');
const le = new Uint8Array(32);
for (let i = 0; i < 32; i++) {
  le[i] = compressed[31 - i];
}
console.log('LE byte 31 (was BE byte 0):', le[31].toString(16).padStart(2, '0'));
console.log('Flag bits: infinity=' + ((le[31] & 0x40) ? '1' : '0') + ', positiveY=' + ((le[31] & 0x80) ? '1' : '0'));
