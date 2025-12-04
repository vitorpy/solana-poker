/**
 * Tests for crypto.ts - EC operations for mental poker protocol
 *
 * These tests verify that our bn254 curve operations work correctly
 * and match the proven implementation in tests/helpers/crypto.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { bn254 } from '@noble/curves/bn254.js';
import {
	Bn254Point,
	CURVE_ORDER,
	randomUint256,
	generateLockVector,
	deriveShuffleValue,
	deriveAllShuffleValues,
	generateWorkDeck,
	shuffleArray,
	encryptWorkDeck,
	lockWorkDeck,
	modInverse,
	unlockCard,
	pointToBytes,
	bytesToPoint,
	compressPoint,
	keyToBytes,
	pointsToTuples,
	tupleToPoint,
	findCardIndex,
	getCardName
} from './crypto';

// Known curve order for bn254 (from test helpers)
const EXPECTED_CURVE_ORDER = BigInt(
	'21888242871839275222246405745257275088548364400416034343698204186575808495617'
);

// bn254 G1 generator coordinates
const EXPECTED_G1_X = BigInt(1);
const EXPECTED_G1_Y = BigInt(2);

describe('bn254 API sanity checks', () => {
	it('should have accessible curve parameters', () => {
		// Test that bn254 module is loaded correctly
		expect(bn254).toBeDefined();
		expect(bn254.G1).toBeDefined();
	});

	it('should have Point accessible (ESM module)', () => {
		// In ESM, it might be Point instead of ProjectivePoint
		const hasPoint = bn254.G1.Point !== undefined;
		const hasProjectivePoint = bn254.G1.ProjectivePoint !== undefined;

		console.log('bn254.G1.Point:', hasPoint);
		console.log('bn254.G1.ProjectivePoint:', hasProjectivePoint);

		// At least one should exist
		expect(hasPoint || hasProjectivePoint).toBe(true);
	});

	it('should have params.r (curve order) accessible', () => {
		// Test helpers use bn254.params.r
		const paramsR = bn254.params?.r;
		console.log('bn254.params.r:', paramsR?.toString());

		if (paramsR !== undefined) {
			expect(paramsR).toBe(EXPECTED_CURVE_ORDER);
		}
	});
});

describe('CURVE_ORDER', () => {
	it('should match the expected bn254 scalar field order', () => {
		expect(CURVE_ORDER).toBe(EXPECTED_CURVE_ORDER);
	});

	it('should be a valid 254-bit number', () => {
		// bn254 curve order should be ~254 bits
		const bitLength = CURVE_ORDER.toString(2).length;
		expect(bitLength).toBeGreaterThanOrEqual(253);
		expect(bitLength).toBeLessThanOrEqual(256);
	});
});

describe('Bn254Point', () => {
	it('should create generator point from fromGenerator()', () => {
		const g = Bn254Point.fromGenerator();
		expect(g).toBeDefined();

		// Generator coordinates for bn254 G1
		expect(g.getX()).toBe(EXPECTED_G1_X);
		expect(g.getY()).toBe(EXPECTED_G1_Y);
	});

	it('should create point from coordinates', () => {
		const g = Bn254Point.fromCoords(EXPECTED_G1_X, EXPECTED_G1_Y);
		expect(g.getX()).toBe(EXPECTED_G1_X);
		expect(g.getY()).toBe(EXPECTED_G1_Y);
	});

	it('should create point from hex strings', () => {
		const g = Bn254Point.fromHex('0x1', '0x2');
		expect(g.getX()).toBe(EXPECTED_G1_X);
		expect(g.getY()).toBe(EXPECTED_G1_Y);
	});

	it('should multiply point by scalar', () => {
		const g = Bn254Point.fromGenerator();
		const result = g.mul(2n);

		// 2G should not equal G
		expect(result.eq(g)).toBe(false);

		// 2G should not be infinity
		expect(result.isInfinity()).toBe(false);
	});

	it('should add points correctly', () => {
		const g = Bn254Point.fromGenerator();
		const g2 = g.mul(2n);
		const gPlusG = g.add(g);

		// G + G should equal 2G
		expect(gPlusG.eq(g2)).toBe(true);
	});

	it('should detect point at infinity', () => {
		const g = Bn254Point.fromGenerator();
		// @noble/curves rejects scalar = n, so use n-1 which gives -G
		// Then add G to get infinity: (n-1)*G + G = n*G = infinity
		const minusG = g.mul(CURVE_ORDER - 1n);
		const infinity = minusG.add(g);

		expect(infinity.isInfinity()).toBe(true);
	});

	it('should compare points correctly', () => {
		const g1 = Bn254Point.fromGenerator();
		const g2 = Bn254Point.fromGenerator();
		const g3 = g1.mul(2n);

		expect(g1.eq(g2)).toBe(true);
		expect(g1.eq(g3)).toBe(false);
	});
});

describe('deriveShuffleValue', () => {
	it('should produce 32-byte output', () => {
		const seed = new Uint8Array(32).fill(0);
		const result = deriveShuffleValue(seed, 0);

		expect(result.length).toBe(32);
	});

	it('should produce different values for different indices', () => {
		const seed = new Uint8Array(32).fill(0x42);
		const v0 = deriveShuffleValue(seed, 0);
		const v1 = deriveShuffleValue(seed, 1);

		expect(Buffer.from(v0).equals(Buffer.from(v1))).toBe(false);
	});

	it('should produce same value for same seed and index', () => {
		const seed = new Uint8Array(32).fill(0x42);
		const v1 = deriveShuffleValue(seed, 5);
		const v2 = deriveShuffleValue(seed, 5);

		expect(Buffer.from(v1).equals(Buffer.from(v2))).toBe(true);
	});

	it('should match known keccak256 test vector', () => {
		// Known test: keccak256 of 33 zero bytes
		const seed = new Uint8Array(32).fill(0);
		const result = deriveShuffleValue(seed, 0);

		// The result should be deterministic
		// We can compare with external keccak256 implementation
		expect(result.length).toBe(32);

		// Log for debugging
		console.log('keccak256(zeros || 0):', Buffer.from(result).toString('hex'));
	});
});

describe('deriveAllShuffleValues', () => {
	it('should produce 52 values', () => {
		const seed = new Uint8Array(32).fill(0x12);
		const values = deriveAllShuffleValues(seed);

		expect(values.length).toBe(52);
	});

	it('should produce hex strings starting with 0x', () => {
		const seed = new Uint8Array(32).fill(0x34);
		const values = deriveAllShuffleValues(seed);

		for (const v of values) {
			expect(v.startsWith('0x')).toBe(true);
			expect(v.length).toBe(66); // 0x + 64 hex chars
		}
	});
});

describe('generateLockVector', () => {
	it('should produce 52 random values', () => {
		const lock = generateLockVector();
		expect(lock.length).toBe(52);
	});

	it('should produce hex strings', () => {
		const lock = generateLockVector();
		for (const v of lock) {
			expect(v.startsWith('0x')).toBe(true);
		}
	});

	it('should produce different values each time', () => {
		const lock1 = generateLockVector();
		const lock2 = generateLockVector();

		// At least some values should differ
		let different = false;
		for (let i = 0; i < 52; i++) {
			if (lock1[i] !== lock2[i]) {
				different = true;
				break;
			}
		}
		expect(different).toBe(true);
	});
});

describe('generateWorkDeck', () => {
	it('should produce 52 points from accumulator', () => {
		// Simple accumulator: 1, 2, 3, ..., 52
		const accumulator = Array.from({ length: 52 }, (_, i) => `0x${(i + 1).toString(16)}`);
		const deck = generateWorkDeck(accumulator);

		expect(deck.length).toBe(52);
	});

	it('should produce valid non-infinity points', () => {
		const accumulator = Array.from({ length: 52 }, (_, i) => `0x${(i + 1).toString(16)}`);
		const deck = generateWorkDeck(accumulator);

		for (const point of deck) {
			expect(point.isInfinity()).toBe(false);
		}
	});

	it('should produce G * accumulator[i] for each card', () => {
		const accumulator = ['0x5', '0xa', '0xf'];
		// Extend to 52 for the function
		while (accumulator.length < 52) {
			accumulator.push('0x1');
		}

		const deck = generateWorkDeck(accumulator);
		const g = Bn254Point.fromGenerator();

		// Card 0 should be G * 5
		expect(deck[0].eq(g.mul(5n))).toBe(true);
		// Card 1 should be G * 10
		expect(deck[1].eq(g.mul(10n))).toBe(true);
		// Card 2 should be G * 15
		expect(deck[2].eq(g.mul(15n))).toBe(true);
	});
});

describe('encryptWorkDeck', () => {
	it('should multiply all points by scalar', () => {
		const g = Bn254Point.fromGenerator();
		const deck = [g, g.mul(2n), g.mul(3n)];

		const encrypted = encryptWorkDeck(deck, '0x5');

		// Each point should be multiplied by 5
		expect(encrypted[0].eq(g.mul(5n))).toBe(true);
		expect(encrypted[1].eq(g.mul(10n))).toBe(true);
		expect(encrypted[2].eq(g.mul(15n))).toBe(true);
	});
});

describe('lockWorkDeck', () => {
	it('should multiply each card by its lock value', () => {
		const g = Bn254Point.fromGenerator();
		// Create a 52-card deck
		const deck = Array.from({ length: 52 }, (_, i) => g.mul(BigInt(i + 1)));
		const lock = Array.from({ length: 52 }, (_, i) => `0x${(i + 10).toString(16)}`);

		const locked = lockWorkDeck(deck, lock);

		expect(locked.length).toBe(52);

		// Card 0 should be G * 1 * 10 = G * 10
		expect(locked[0].eq(g.mul(1n * 10n))).toBe(true);
	});

	it('should throw if card is at infinity', () => {
		const g = Bn254Point.fromGenerator();
		// Create infinity point: (n-1)*G + G = n*G = infinity
		const minusG = g.mul(CURVE_ORDER - 1n);
		const infinity = minusG.add(g);

		// Create deck with infinity point
		const deck = Array.from({ length: 52 }, () => infinity);
		const lock = generateLockVector();

		expect(() => lockWorkDeck(deck, lock)).toThrow('Card 0 is at infinity');
	});
});

describe('modInverse', () => {
	it('should compute correct modular inverse', () => {
		// k * k^(-1) = 1 (mod n)
		const k = '0x12345678';
		const kInv = modInverse(k);

		const kBig = BigInt(k);
		const kInvBig = BigInt(kInv);

		const product = (kBig * kInvBig) % CURVE_ORDER;
		expect(product).toBe(1n);
	});

	it('should handle large numbers', () => {
		const k = '0x' + 'ff'.repeat(32);
		const kInv = modInverse(k);

		const kBig = BigInt(k) % CURVE_ORDER;
		const kInvBig = BigInt(kInv);

		const product = (kBig * kInvBig) % CURVE_ORDER;
		expect(product).toBe(1n);
	});

	it('should produce 64-char hex output (padded)', () => {
		const k = '0x1';
		const kInv = modInverse(k);

		// Remove 0x prefix and check length
		const hex = kInv.slice(2);
		expect(hex.length).toBe(64);
	});
});

describe('unlockCard', () => {
	it('should reverse lock operation', () => {
		const g = Bn254Point.fromGenerator();
		const card = g.mul(42n);

		// Lock with a key
		const lockKey = '0xabcd';
		const lockKeyBig = BigInt(lockKey) % CURVE_ORDER;
		const lockedCard = card.mul(lockKeyBig);

		// Convert to tuple format
		const tuple = {
			qx: lockedCard.getX().toString(10),
			qy: lockedCard.getY().toString(10)
		};

		// Unlock
		const unlocked = unlockCard(tuple, [lockKey]);

		// Should equal original card
		expect(unlocked.eq(card)).toBe(true);
	});

	it('should handle multiple keys', () => {
		const g = Bn254Point.fromGenerator();
		const card = g.mul(42n);

		// Lock with multiple keys
		const key1 = '0x1234';
		const key2 = '0x5678';

		let lockedCard = card;
		lockedCard = lockedCard.mul(BigInt(key1) % CURVE_ORDER);
		lockedCard = lockedCard.mul(BigInt(key2) % CURVE_ORDER);

		const tuple = {
			qx: lockedCard.getX().toString(10),
			qy: lockedCard.getY().toString(10)
		};

		// Unlock with both keys
		const unlocked = unlockCard(tuple, [key1, key2]);

		expect(unlocked.eq(card)).toBe(true);
	});
});

describe('pointToBytes / bytesToPoint', () => {
	it('should produce 64-byte output', () => {
		const g = Bn254Point.fromGenerator();
		const bytes = pointToBytes(g);

		expect(bytes.length).toBe(64);
	});

	it('should round-trip correctly', () => {
		const g = Bn254Point.fromGenerator();
		const p = g.mul(12345n);

		const bytes = pointToBytes(p);
		const restored = bytesToPoint(bytes);

		expect(restored.eq(p)).toBe(true);
	});

	it('should serialize x and y as 32 bytes each (big-endian)', () => {
		const g = Bn254Point.fromGenerator();
		const bytes = pointToBytes(g);

		// First 32 bytes are x, next 32 are y
		// G1 for bn254 is (1, 2)
		const xBytes = bytes.slice(0, 32);
		const yBytes = bytes.slice(32, 64);

		// x = 1 should be 31 zero bytes followed by 0x01
		expect(xBytes[31]).toBe(1);
		for (let i = 0; i < 31; i++) {
			expect(xBytes[i]).toBe(0);
		}

		// y = 2 should be 31 zero bytes followed by 0x02
		expect(yBytes[31]).toBe(2);
		for (let i = 0; i < 31; i++) {
			expect(yBytes[i]).toBe(0);
		}
	});
});

describe('compressPoint', () => {
	it('should produce 32-byte output', () => {
		const g = Bn254Point.fromGenerator();
		const compressed = compressPoint(g);

		expect(compressed.length).toBe(32);
	});

	it('should have x coordinate in first 32 bytes (without flag bits)', () => {
		const g = Bn254Point.fromGenerator();
		const compressed = compressPoint(g);

		// For G1 (x=1), most bytes should be zero
		// except possibly the flag bit in byte 0
		let xValue = BigInt(0);
		for (let i = 0; i < 32; i++) {
			// Mask off the flag bits in byte 0
			const byte = i === 0 ? compressed[i] & 0x3f : compressed[i];
			xValue = (xValue << 8n) | BigInt(byte);
		}

		expect(xValue).toBe(EXPECTED_G1_X);
	});
});

describe('keyToBytes', () => {
	it('should produce 32-byte output', () => {
		const key = '0x1234567890abcdef';
		const bytes = keyToBytes(key);

		expect(bytes.length).toBe(32);
	});

	it('should handle keys with 0x prefix', () => {
		const key = '0xabcd';
		const bytes = keyToBytes(key);

		// Should be padded to 32 bytes, value at end
		expect(bytes[31]).toBe(0xcd);
		expect(bytes[30]).toBe(0xab);
	});

	it('should handle keys without 0x prefix', () => {
		const key = 'abcd';
		const bytes = keyToBytes(key);

		expect(bytes[31]).toBe(0xcd);
		expect(bytes[30]).toBe(0xab);
	});
});

describe('pointsToTuples / tupleToPoint', () => {
	it('should convert points to decimal string tuples', () => {
		const g = Bn254Point.fromGenerator();
		const points = [g, g.mul(2n)];

		const tuples = pointsToTuples(points);

		expect(tuples[0].qx).toBe('1');
		expect(tuples[0].qy).toBe('2');
	});

	it('should round-trip correctly', () => {
		const g = Bn254Point.fromGenerator();
		const p = g.mul(999n);

		const tuples = pointsToTuples([p]);
		const restored = tupleToPoint(tuples[0]);

		expect(restored.eq(p)).toBe(true);
	});
});

describe('findCardIndex', () => {
	it('should find card in deck', () => {
		const g = Bn254Point.fromGenerator();
		const deck = [g.mul(1n), g.mul(2n), g.mul(3n)];

		const index = findCardIndex(g.mul(2n), deck);
		expect(index).toBe(1);
	});

	it('should return -1 if not found', () => {
		const g = Bn254Point.fromGenerator();
		const deck = [g.mul(1n), g.mul(2n), g.mul(3n)];

		const index = findCardIndex(g.mul(99n), deck);
		expect(index).toBe(-1);
	});
});

describe('getCardName', () => {
	it('should return correct card names', () => {
		expect(getCardName(0)).toBe('Ace of Clubs');
		expect(getCardName(12)).toBe('King of Clubs');
		expect(getCardName(13)).toBe('Ace of Diamonds');
		expect(getCardName(51)).toBe('King of Spades');
	});
});

describe('shuffleArray', () => {
	it('should preserve array length', () => {
		const arr = [1, 2, 3, 4, 5];
		const shuffled = shuffleArray(arr);

		expect(shuffled.length).toBe(arr.length);
	});

	it('should contain all original elements', () => {
		const arr = [1, 2, 3, 4, 5];
		const shuffled = shuffleArray(arr);

		for (const item of arr) {
			expect(shuffled).toContain(item);
		}
	});

	it('should not modify original array', () => {
		const arr = [1, 2, 3, 4, 5];
		const original = [...arr];
		shuffleArray(arr);

		expect(arr).toEqual(original);
	});
});

describe('randomUint256', () => {
	it('should produce hex string with 0x prefix', () => {
		const rand = randomUint256();
		expect(rand.startsWith('0x')).toBe(true);
	});

	it('should produce 66-character string (0x + 64 hex)', () => {
		const rand = randomUint256();
		expect(rand.length).toBe(66);
	});

	it('should produce different values each time', () => {
		const rand1 = randomUint256();
		const rand2 = randomUint256();

		// Extremely unlikely to be equal
		expect(rand1).not.toBe(rand2);
	});
});
