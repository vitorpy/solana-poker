/**
 * Elliptic curve cryptography helpers for mental poker
 *
 * Uses bn254 (alt_bn128) curve for card encryption/decryption
 * This matches Solana's native EC syscalls for on-chain verification
 */

import { bn254 } from '@noble/curves/bn254.js';
import { keccak256 as keccak256Hash } from 'js-sha3';

// Type for point tuple (as stored on-chain)
export interface PointTuple {
	qx: string;
	qy: string;
}

// The bn254 curve order (n) - also called 'r' in the params
export const CURVE_ORDER = bn254.params.r;

// bn254 generator point G1
const G1 = bn254.G1.ProjectivePoint.BASE;

// Field prime for bn254
const BN254_FIELD_PRIME = BigInt(
	'0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47'
);
const HALF_FIELD_PRIME = BN254_FIELD_PRIME / 2n;

/**
 * Wrapper class for bn254 G1 points that provides a consistent interface
 */
export class Bn254Point {
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

	getX(): bigint {
		return this.point.toAffine().x;
	}

	getY(): bigint {
		return this.point.toAffine().y;
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
	const rand = new Uint8Array(32);
	crypto.getRandomValues(rand);
	return `0x${Buffer.from(rand).toString('hex')}`;
}

/**
 * Generate an array of 52 random 256-bit numbers (lock vector)
 */
export function generateLockVector(): string[] {
	const array: string[] = [];
	for (let i = 0; i < 52; i++) {
		array.push(randomUint256());
	}
	return array;
}

/**
 * Derive a shuffle value from a seed and index
 * v[i] = keccak256(seed || i)
 *
 * This must match the on-chain derivation in generate.rs
 */
export function deriveShuffleValue(seed: Uint8Array, index: number): Uint8Array {
	// Create preimage: seed (32 bytes) || index (1 byte)
	const preimage = new Uint8Array(33);
	preimage.set(seed, 0);
	preimage[32] = index;

	// Use proper Keccak256 (NOT SHA3-256 - they are different!)
	const hash = keccak256Hash(preimage);
	return new Uint8Array(Buffer.from(hash, 'hex'));
}

/**
 * Derive all 52 shuffle values from a seed
 * Returns array of hex strings
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
export function shuffleArray<T>(array: T[]): T[] {
	const shuffled = [...array];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
	}
	return shuffled;
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
 * Compress an EC point to 32 bytes (arkworks/Solana format)
 * Format: [x: 32 bytes BE, with flags embedded in top bits]
 *
 * In arkworks serialization for bn254 compressed G1:
 * - Bit 7 (0x80) of MSB byte: PositiveY flag (1 if y > p/2)
 * - Bit 6 (0x40) of MSB byte: Infinity flag
 */
export function compressPoint(point: Bn254Point): Uint8Array {
	const compressed = new Uint8Array(32);

	// Get x coordinate as hex, pad to 64 chars
	const xHex = point.getX().toString(16).padStart(64, '0');

	// Convert x coordinate to bytes (big-endian)
	for (let i = 0; i < 32; i++) {
		compressed[i] = parseInt(xHex.substr(i * 2, 2), 16);
	}

	// Get y coordinate as bigint
	const y = point.getY();

	// Set PositiveY flag in bit 7 of first byte if y > p/2
	if (y > HALF_FIELD_PRIME) {
		compressed[0] |= 0x80;
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
	let xHex = '';
	let yHex = '';

	for (let i = 0; i < 32; i++) {
		xHex += bytes[i].toString(16).padStart(2, '0');
		yHex += bytes[32 + i].toString(16).padStart(2, '0');
	}

	return Bn254Point.fromHex(xHex, yHex);
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
 * Transform an array of EC points to tuple array format
 */
export function pointsToTuples(points: Bn254Point[]): PointTuple[] {
	return points.map((point) => ({
		qx: point.getX().toString(10),
		qy: point.getY().toString(10)
	}));
}

/**
 * Transform a tuple back to an EC point
 */
export function tupleToPoint(tp: PointTuple): Bn254Point {
	return Bn254Point.fromHex(tp.qx, tp.qy);
}

/**
 * Check if two cards are equal
 */
export function areCardsEqual(card1: Bn254Point, card2: Bn254Point): boolean {
	return card1.eq(card2);
}

/**
 * Find card index in original deck
 */
export function findCardIndex(drawnCard: Bn254Point, originalDeck: Bn254Point[]): number {
	for (let i = 0; i < originalDeck.length; i++) {
		if (drawnCard.eq(originalDeck[i])) {
			return i;
		}
	}
	return -1;
}

/**
 * Get card name from card index (0-51)
 */
export function getCardName(cardIndex: number): string {
	const suits = ['Clubs', 'Diamonds', 'Hearts', 'Spades'];
	const values = [
		'Ace',
		'Two',
		'Three',
		'Four',
		'Five',
		'Six',
		'Seven',
		'Eight',
		'Nine',
		'Ten',
		'Jack',
		'Queen',
		'King'
	];

	const suit = suits[Math.floor(cardIndex / 13)];
	const value = values[cardIndex % 13];

	return `${value} of ${suit}`;
}
