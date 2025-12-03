/**
 * Debug script to verify compression format
 */
import { bn254 } from '@noble/curves/bn254';

// bn254 field prime and half prime
const BN254_FIELD_PRIME = BigInt('0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47');
const HALF_FIELD_PRIME = BN254_FIELD_PRIME / 2n;
const CURVE_ORDER = bn254.params.r;

// Generator point
const G1 = bn254.G1.ProjectivePoint.BASE;

// Test our compression
function compressPoint(point: typeof G1): Uint8Array {
  const affine = point.toAffine();
  const x = affine.x;
  const y = affine.y;
  
  const compressed = new Uint8Array(32);
  const xHex = x.toString(16).padStart(64, '0');
  
  for (let i = 0; i < 32; i++) {
    compressed[i] = parseInt(xHex.substr(i * 2, 2), 16);
  }
  
  // Set PositiveY flag if y > p/2
  if (y > HALF_FIELD_PRIME) {
    compressed[0] |= 0x80;
  }
  
  return compressed;
}

// Test with generator point
console.log('=== Generator Point G ===');
const G = G1;
const gAffine = G.toAffine();
console.log('x:', gAffine.x.toString(16));
console.log('y:', gAffine.y.toString(16));
console.log('y > p/2:', gAffine.y > HALF_FIELD_PRIME);
const gCompressed = compressPoint(G);
console.log('compressed (hex):', Buffer.from(gCompressed).toString('hex'));
console.log('byte 0:', gCompressed[0].toString(16).padStart(2, '0'));

// Test with G * 2
console.log('\n=== Point G * 2 ===');
const G2 = G.multiply(2n);
const g2Affine = G2.toAffine();
console.log('x:', g2Affine.x.toString(16));
console.log('y:', g2Affine.y.toString(16));
console.log('y > p/2:', g2Affine.y > HALF_FIELD_PRIME);
const g2Compressed = compressPoint(G2);
console.log('compressed (hex):', Buffer.from(g2Compressed).toString('hex'));
console.log('byte 0:', g2Compressed[0].toString(16).padStart(2, '0'));

// Test with G * large scalar (similar to what accumulator produces)
console.log('\n=== Point G * largeScalar (mod n) ===');
const largeScalar = BigInt('0xabcdef123456789012345678901234567890') % CURVE_ORDER;
const Glarge = G.multiply(largeScalar);
const gLargeAffine = Glarge.toAffine();
console.log('x:', gLargeAffine.x.toString(16));
console.log('y:', gLargeAffine.y.toString(16));
console.log('y > p/2:', gLargeAffine.y > HALF_FIELD_PRIME);
const gLargeCompressed = compressPoint(Glarge);
console.log('compressed (hex):', Buffer.from(gLargeCompressed).toString('hex'));
console.log('byte 0:', gLargeCompressed[0].toString(16).padStart(2, '0'));

// Verify the x-coordinate doesn't conflict with flags
console.log('\n=== Checking flag safety ===');
console.log('Field prime first byte:', (BN254_FIELD_PRIME >> 248n).toString(16));
console.log('If first byte of x is <= 0x30, flags (0x80, 0x40) are safe');
