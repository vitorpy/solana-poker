/**
 * Debug script to verify y > p/2 vs y < p/2 convention
 */
import { bn254 } from '@noble/curves/bn254';

const BN254_FIELD_PRIME = BigInt('0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47');
const HALF_FIELD_PRIME = BN254_FIELD_PRIME / 2n;
const CURVE_ORDER = bn254.params.r;
const G1 = bn254.G1.ProjectivePoint.BASE;

// At scalar 3, we have a point with y > p/2
const point = G1.multiply(3n);
const affine = point.toAffine();

console.log('Point G*3:');
console.log('x:', affine.x.toString(16).padStart(64, '0'));
console.log('y:', affine.y.toString(16).padStart(64, '0'));
console.log('y > p/2:', affine.y > HALF_FIELD_PRIME);

// Compute the "negated" y (which would be p - y)
const negY = BN254_FIELD_PRIME - affine.y;
console.log('\nNegated y (p - y):', negY.toString(16).padStart(64, '0'));
console.log('negY > p/2:', negY > HALF_FIELD_PRIME);

// The two y values for this x should be y and negY
console.log('\n=== The two possible y values for this x ===');
console.log('y1 (actual):', affine.y > HALF_FIELD_PRIME ? 'LARGER (> p/2)' : 'SMALLER (<= p/2)');
console.log('y2 (negated):', negY > HALF_FIELD_PRIME ? 'LARGER (> p/2)' : 'SMALLER (<= p/2)');

// In arkworks SWFlags:
// - PositiveY = 0x80 means "use the larger y" (y > p/2)
// So if our y > p/2, we should set the flag (0x80)
// If our y <= p/2, we should NOT set the flag

console.log('\n=== Compression logic check ===');
console.log('If y > p/2, flag should be SET (0x80) -> arkworks picks larger y');
console.log('If y <= p/2, flag should be CLEAR -> arkworks picks smaller y');
console.log('Our y is', affine.y > HALF_FIELD_PRIME ? 'LARGER' : 'SMALLER', '-> flag should be', affine.y > HALF_FIELD_PRIME ? 'SET' : 'CLEAR');

// Show what the compressed bytes look like
const xHex = affine.x.toString(16).padStart(64, '0');
console.log('\n=== x coordinate bytes ===');
console.log('x hex (padded):', xHex);
console.log('x first byte:', xHex.substring(0, 2), '=', parseInt(xHex.substring(0, 2), 16));

// The first byte of x should be small (< 0x31 since field prime starts with 0x30)
// So we have room for flags in bits 6 and 7
const firstXByte = parseInt(xHex.substring(0, 2), 16);
console.log('After adding flag 0x80:', (firstXByte | 0x80).toString(16));

// After BE->LE conversion, this byte moves to position 31
console.log('\n=== After BE->LE conversion ===');
console.log('The flag byte will be at LE position 31');
console.log('Arkworks reads bit 7 of byte 31 as PositiveY flag');
