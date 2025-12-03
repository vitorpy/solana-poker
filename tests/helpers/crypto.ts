/**
 * Elliptic curve cryptography helpers for mental poker
 *
 * Uses bn254 (alt_bn128) curve for card encryption/decryption
 * This matches Solana's native EC syscalls for on-chain verification
 */

import { bn254 } from '@noble/curves/bn254';
import BN from 'bn.js';
import * as crypto from 'crypto';
import { keccak256 as keccak256Hash } from 'js-sha3';

// Type for EC points (wrapper around bn254 point)
export interface ECPoint {
  x: bigint;
  y: bigint;
  isInfinity: boolean;
}

// Type for point tuple (as stored on-chain)
export interface PointTuple {
  qx: string;
  qy: string;
}

// The bn254 curve order (n) - also called 'r' in the params
export const CURVE_ORDER = bn254.params.r;

// bn254 generator point G1
const G1 = bn254.G1.ProjectivePoint.BASE;

/**
 * Wrapper class for bn254 G1 points that provides a consistent interface
 */
class Bn254Point {
  private point: typeof bn254.G1.ProjectivePoint.BASE;

  constructor(point: typeof bn254.G1.ProjectivePoint.BASE) {
    this.point = point;
  }

  static fromGenerator(): Bn254Point {
    return new Bn254Point(G1);
  }

  static fromCoords(x: bigint, y: bigint): Bn254Point {
    return new Bn254Point(bn254.G1.ProjectivePoint.fromAffine({ x, y }));
  }

  static fromHex(x: string, y: string): Bn254Point {
    const xBig = BigInt('0x' + x.replace('0x', ''));
    const yBig = BigInt('0x' + y.replace('0x', ''));
    return Bn254Point.fromCoords(xBig, yBig);
  }

  mul(scalar: bigint): Bn254Point {
    return new Bn254Point(this.point.multiply(scalar));
  }

  add(other: Bn254Point): Bn254Point {
    return new Bn254Point(this.point.add(other.point));
  }

  getX(): { toString: (radix: number) => string } {
    const affine = this.point.toAffine();
    return {
      toString: (radix: number) => affine.x.toString(radix)
    };
  }

  getY(): {
    toString: (radix: number) => string;
    isOdd: () => boolean;
  } {
    const affine = this.point.toAffine();
    return {
      toString: (radix: number) => affine.y.toString(radix),
      isOdd: () => (affine.y & 1n) === 1n
    };
  }

  isInfinity(): boolean {
    return this.point.equals(bn254.G1.ProjectivePoint.ZERO);
  }

  eq(other: Bn254Point): boolean {
    return this.point.equals(other.point);
  }

  toRaw(): typeof bn254.G1.ProjectivePoint.BASE {
    return this.point;
  }
}

/**
 * Generate a random 256-bit number as hex string
 */
export function randomUint256(): string {
  const rand = crypto.randomBytes(32);
  return `0x${rand.toString('hex')}`;
}

/**
 * Generate an array of 52 random 256-bit numbers (one per card)
 * @deprecated Use generateShuffleSeed() with seed-based derivation instead
 */
export function generateRandomArray(): string[] {
  const array: string[] = [];
  for (let i = 0; i < 52; i++) {
    array.push(randomUint256());
  }
  return array;
}

/**
 * Calculate Keccak256 hash of a uint256 array
 * This is used for commitment schemes
 * @deprecated Use calculateSeedCommitment() for seed-based commitment
 */
export function calculateKeccak256Hash(array: string[]): Uint8Array {
  // Create a buffer with all values concatenated (32 bytes each)
  const buffer = Buffer.alloc(array.length * 32);
  for (let i = 0; i < array.length; i++) {
    const value = array[i].startsWith('0x') ? array[i].slice(2) : array[i];
    const paddedValue = value.padStart(64, '0');
    buffer.write(paddedValue, i * 32, 32, 'hex');
  }

  // Use proper Keccak256 (NOT SHA3-256 - they are different!)
  const hash = keccak256Hash(buffer);
  return new Uint8Array(Buffer.from(hash, 'hex'));
}

/**
 * Generate a random 32-byte shuffle seed
 * This seed is used for deterministic derivation of all 52 shuffle values
 */
export function generateShuffleSeed(): Uint8Array {
  return crypto.randomBytes(32);
}

/**
 * Calculate the commitment for a shuffle seed
 * commitment = keccak256(seed)
 *
 * This is what gets stored on-chain during JoinGame.
 * The hiding property ensures other players can't see the seed until Generate.
 */
export function calculateSeedCommitment(seed: Uint8Array): Uint8Array {
  // Use proper Keccak256 (NOT SHA3-256 - they are different!)
  const hash = keccak256Hash(seed);
  return new Uint8Array(Buffer.from(hash, 'hex'));
}

/**
 * Derive a shuffle value from a seed and index
 * v[i] = keccak256(seed || i)
 *
 * This must match the on-chain derivation in generate.rs
 * Used by the client for shuffle/lock/reveal operations
 */
export function deriveShuffleValue(seed: Uint8Array, index: number): Uint8Array {
  // Create preimage: seed (32 bytes) || index (1 byte)
  const preimage = Buffer.alloc(33);
  preimage.set(seed, 0);
  preimage.writeUInt8(index, 32);

  // Use proper Keccak256 (NOT SHA3-256 - they are different!)
  const hash = keccak256Hash(preimage);
  return new Uint8Array(Buffer.from(hash, 'hex'));
}

/**
 * Derive all 52 shuffle values from a seed
 * Returns array of hex strings for compatibility with existing code
 */
export function deriveAllShuffleValues(seed: Uint8Array): string[] {
  const values: string[] = [];
  for (let i = 0; i < 52; i++) {
    const derived = deriveShuffleValue(seed, i);
    values.push('0x' + Buffer.from(derived).toString('hex'));
  }
  return values;
}

/**
 * Generate the initial work deck from accumulator values
 * Each card is G * accumulator[i] where G is the generator point
 */
export function generateWorkDeck(accumulator: string[]): Bn254Point[] {
  return accumulator.map((m) => {
    const scalar = BigInt(m.toString().replace('0x', '0x') || '0');
    // scalar mod n to ensure it's in valid range
    const scalarMod = scalar % CURVE_ORDER;
    return Bn254Point.fromGenerator().mul(scalarMod);
  });
}

/**
 * Shuffle the work deck (Fisher-Yates shuffle)
 */
export function shuffleWorkDeck<T>(workDeck: T[]): T[] {
  const shuffled = [...workDeck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Transform an array of EC points to tuple array format for on-chain storage
 */
export function transformPointArrayToTupleArray(original: Bn254Point[]): PointTuple[] {
  return original.map((element) => {
    if (element && element.getX) {
      return {
        qx: element.getX().toString(10),
        qy: element.getY().toString(10),
      };
    }
    return { qx: '0', qy: '0' };
  });
}

/**
 * Transform a tuple back to an EC point
 */
export function transformTupleToPoint(tp: PointTuple): Bn254Point {
  return Bn254Point.fromHex(tp.qx, tp.qy);
}

/**
 * Transform an array of tuples to EC points
 */
export function transformTupleArrayToPointArray(original: PointTuple[]): Bn254Point[] {
  return original.map((m) => transformTupleToPoint(m));
}

/**
 * Encrypt work deck by multiplying each point by scalar s
 * This is the encryption step where each player multiplies by their secret key
 */
export function encryptWorkDeck(workDeck: Bn254Point[], s: string): Bn254Point[] {
  const scalar = BigInt(s.toString().replace('0x', '0x') || '0');
  const scalarMod = scalar % CURVE_ORDER;

  return workDeck.map((point) => {
    return point.mul(scalarMod);
  });
}

/**
 * Decrypt work deck by multiplying each point by the modular inverse of each key
 * This reverses the encryption layers
 */
export function decryptWorkDeck(workDeck: Bn254Point[], keys: string[]): Bn254Point[] {
  return workDeck.map((point) => {
    let decrypted = point;

    for (const key of keys) {
      const keyBig = BigInt(key.toString().replace('0x', '0x') || '0');
      // Compute modular inverse using Fermat's little theorem: k^(-1) = k^(n-2) mod n
      const keyInv = modPow(keyBig, CURVE_ORDER - 2n, CURVE_ORDER);
      decrypted = decrypted.mul(keyInv);

      if (decrypted.isInfinity()) {
        throw new Error('Point at infinity after decryption - invalid key');
      }
    }

    return decrypted;
  });
}

/**
 * Modular exponentiation: base^exp mod m
 */
function modPow(base: bigint, exp: bigint, m: bigint): bigint {
  let result = 1n;
  base = base % m;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % m;
    }
    exp = exp / 2n;
    base = (base * base) % m;
  }
  return result;
}

/**
 * Compute modular inverse using Fermat's little theorem
 * inv = a^(n-2) mod n
 *
 * IMPORTANT: The input is first reduced mod CURVE_ORDER to match
 * what lockWorkDeck does when applying lock keys.
 */
export function modInverse(a: string): string {
  const aBig = BigInt(a.toString().replace('0x', '0x') || '0');
  // First reduce mod n to match what lockWorkDeck does
  const aReduced = aBig % CURVE_ORDER;
  // inv = a^(n-2) mod n
  const inv = modPow(aReduced, CURVE_ORDER - 2n, CURVE_ORDER);
  return '0x' + inv.toString(16).padStart(64, '0');
}

/**
 * Lock work deck by multiplying each card by its individual lock value
 * Each player applies their own lock array (52 random values)
 */
export function lockWorkDeck(workDeck: Bn254Point[], lock: string[]): Bn254Point[] {
  const points: Bn254Point[] = [];

  for (let i = 0; i < 52; i++) {
    const lockBig = BigInt(lock[i].toString().replace('0x', '0x') || '0');
    const lockMod = lockBig % CURVE_ORDER;
    const lockedPoint = workDeck[i].mul(lockMod);

    if (workDeck[i].isInfinity()) {
      throw new Error(`Card ${i} is at infinity before locking`);
    }

    points.push(lockedPoint);
  }

  return points;
}

/**
 * Unlock a single card by multiplying by the modular inverse of each lock key
 */
export function unlockCard(lockedCard: PointTuple, keys: string[]): Bn254Point {
  let card = Bn254Point.fromHex(lockedCard.qx, lockedCard.qy);

  for (const key of keys) {
    const keyBig = BigInt(key.toString().replace('0x', '0x') || '0');
    const keyInv = modPow(keyBig, CURVE_ORDER - 2n, CURVE_ORDER);
    card = card.mul(keyInv);
  }

  return card;
}

/**
 * Check if two cards are equal
 */
export function areCardsEqual(card1: Bn254Point, card2: Bn254Point): boolean {
  return card1.eq(card2);
}

/**
 * Find if any card in deck1 matches any card in deck2
 */
export function findAnyMatch(workdeck1: Bn254Point[], workdeck2: Bn254Point[]): boolean {
  for (const card1 of workdeck1) {
    for (const card2 of workdeck2) {
      if (card1.eq(card2)) {
        return true;
      }
    }
  }
  return false;
}

// Field prime for bn254: p = 21888242871839275222246405745257275088696311157297823662689037894645226208583
const BN254_FIELD_PRIME = BigInt('0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47');
const HALF_FIELD_PRIME = BN254_FIELD_PRIME / 2n;

/**
 * Compress an EC point to 32 bytes (arkworks/Solana format)
 * Format: [x: 32 bytes BE, with flags embedded in top bits]
 *
 * In arkworks serialization for bn254 compressed G1 (SWFlags):
 * - Bit 7 (0x80) of MSB byte: PositiveY flag (1 if y > p/2)
 * - Bit 6 (0x40) of MSB byte: Infinity flag (for point at infinity)
 *
 * After Solana's BE->LE conversion, byte 0 becomes byte 31, so:
 * - We set bit 7 (0x80) in byte 0 (BE) which becomes bit 7 of byte 31 (LE)
 */
export function compressPoint(point: Bn254Point): Uint8Array {
  const compressed = new Uint8Array(32);

  // Get x coordinate as hex, pad to 64 chars
  const xHex = point.getX().toString(16).padStart(64, '0');

  // Convert x coordinate to bytes (big-endian, Solana converts BE->LE internally)
  for (let i = 0; i < 32; i++) {
    compressed[i] = parseInt(xHex.substr(i * 2, 2), 16);
  }

  // Get y coordinate as bigint
  const yHex = point.getY().toString(16);
  const y = BigInt('0x' + yHex);

  // Set PositiveY flag in bit 7 of first byte (MSB in BE) if y > p/2
  // After Solana's BE->LE conversion, this becomes bit 7 of byte 31 (arkworks PositiveY flag)
  // Note: bit 6 (0x40) is the infinity flag, NOT y parity!
  if (y > HALF_FIELD_PRIME) {
    compressed[0] |= 0x80; // Bit 7 = PositiveY flag
  }

  return compressed;
}

/**
 * Convert point to bytes for on-chain storage
 * Returns [x: 32 bytes, y: 32 bytes]
 */
export function pointToBytes(point: Bn254Point): Uint8Array {
  const bytes = new Uint8Array(64);

  const xHex = point.getX().toString(16).padStart(64, '0');
  const yHex = point.getY().toString(16).padStart(64, '0');

  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(xHex.substr(i * 2, 2), 16);
    bytes[32 + i] = parseInt(yHex.substr(i * 2, 2), 16);
  }

  return bytes;
}

/**
 * Convert bytes to point
 */
export function bytesToPoint(bytes: Uint8Array): Bn254Point {
  const xHex = Buffer.from(bytes.slice(0, 32)).toString('hex');
  const yHex = Buffer.from(bytes.slice(32, 64)).toString('hex');

  return Bn254Point.fromHex(xHex, yHex);
}

/**
 * Get the curve order as bytes (for passing to on-chain program)
 */
export function getCurveOrderBytes(): Uint8Array {
  const nHex = CURVE_ORDER.toString(16).padStart(64, '0');
  const bytes = new Uint8Array(32);

  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(nHex.substr(i * 2, 2), 16);
  }

  return bytes;
}

/**
 * Convert a string key to bytes
 */
export function keyToBytes(key: string): Uint8Array {
  const cleanKey = key.startsWith('0x') ? key.slice(2) : key;
  const paddedKey = cleanKey.padStart(64, '0');
  const bytes = new Uint8Array(32);

  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(paddedKey.substr(i * 2, 2), 16);
  }

  return bytes;
}

/**
 * Convert iterator to player index (circular)
 */
export function convertIteratorToIndex(startingPlayer: number, iterator: number, playerCount: number): number {
  return (startingPlayer + iterator) % playerCount;
}

/**
 * Get next player index, skipping folded players
 */
export function getNextPlayer(currentIndex: number, playerCount: number, foldedPlayers: number[]): number {
  let index = (currentIndex + 1) % playerCount;
  while (foldedPlayers.includes(index)) {
    index = (index + 1) % playerCount;
  }
  return index;
}

/**
 * Get previous player index, skipping folded players
 */
export function getPreviousPlayer(currentIndex: number, playerCount: number, foldedPlayers: number[]): number {
  let index = currentIndex === 0 ? playerCount - 1 : currentIndex - 1;
  while (foldedPlayers.includes(index)) {
    index = index === 0 ? playerCount - 1 : index - 1;
  }
  return index;
}

/**
 * Get card name from card index (0-51)
 */
export function getCardName(cardIndex: number): string {
  const suits = ['Clubs', 'Diamonds', 'Hearts', 'Spades'];
  const values = ['Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'];

  const suit = suits[Math.floor(cardIndex / 13)];
  const value = values[cardIndex % 13];

  return `${value}_${suit}`;
}

/**
 * Get hand name from hand enum value
 */
export function getHandName(handValue: number): string {
  const hands = [
    'RoyalFlush',
    'StraightFlush',
    'FourOfAKind',
    'FullHouse',
    'Flush',
    'Straight',
    'ThreeOfAKind',
    'TwoPair',
    'Pair',
    'HighCard',
  ];

  return hands[handValue] || 'Unknown';
}

/**
 * Get token amount for a given number of tokens (with decimals)
 */
export function getTokenAmount(amount: number, decimals: number = 9): bigint {
  return BigInt(amount) * BigInt(10 ** decimals);
}
