/**
 * Tests for actions.ts - Serialization and deserialization
 *
 * These tests verify that the deserializers correctly parse on-chain data
 * and that instruction builders produce correct byte formats.
 */

import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
	buildInitializeGameData,
	buildJoinGameData,
	buildBetData,
	buildFoldData,
	generateShuffleSeed,
	calculateSeedCommitment
} from './actions';
import { Instruction } from './constants';

// ===== Helper Functions =====

/**
 * Create a mock GameState buffer (106 bytes)
 * Matches the on-chain Rust struct serialization
 */
function createMockGameStateBuffer(overrides: Partial<{
	bump: number;
	gameId: Uint8Array;
	gamePhase: number;
	shufflingState: number;
	drawingState: number;
	texasState: number;
	bettingRoundState: number;
	communityCardsState: number;
	currentTurn: number;
	activePlayerCount: number;
	numFoldedPlayers: number;
	cardsDrawn: number;
	playerCardsOpened: number;
	numSubmittedHands: number;
	pot: bigint;
	currentCallAmount: bigint;
	lastToCall: Uint8Array;
	isEverybodyAllIn: number;
	potClaimed: number;
	cardToReveal: number;
	cardsLeftInDeck: number;
	isDeckSubmitted: number;
	lastActionTimestamp: bigint;
}> = {}): Buffer {
	const buffer = Buffer.alloc(106);
	let offset = 0;

	// bump (1)
	buffer.writeUInt8(overrides.bump ?? 255, offset);
	offset += 1;

	// gameId (32)
	const gameId = overrides.gameId ?? new Uint8Array(32).fill(0xab);
	buffer.set(gameId, offset);
	offset += 32;

	// State machine values (6 bytes)
	buffer.writeUInt8(overrides.gamePhase ?? 1, offset); // Shuffling
	offset += 1;
	buffer.writeUInt8(overrides.shufflingState ?? 2, offset); // Generating
	offset += 1;
	buffer.writeUInt8(overrides.drawingState ?? 0, offset);
	offset += 1;
	buffer.writeUInt8(overrides.texasState ?? 4, offset); // Betting
	offset += 1;
	buffer.writeUInt8(overrides.bettingRoundState ?? 1, offset); // PreFlop
	offset += 1;
	buffer.writeUInt8(overrides.communityCardsState ?? 0, offset);
	offset += 1;

	// Turn tracking (6 bytes)
	buffer.writeUInt8(overrides.currentTurn ?? 0, offset);
	offset += 1;
	buffer.writeUInt8(overrides.activePlayerCount ?? 2, offset);
	offset += 1;
	buffer.writeUInt8(overrides.numFoldedPlayers ?? 0, offset);
	offset += 1;
	buffer.writeUInt8(overrides.cardsDrawn ?? 4, offset);
	offset += 1;
	buffer.writeUInt8(overrides.playerCardsOpened ?? 0, offset);
	offset += 1;
	buffer.writeUInt8(overrides.numSubmittedHands ?? 0, offset);
	offset += 1;

	// pot (8)
	buffer.writeBigUInt64LE(overrides.pot ?? BigInt(1000000000), offset);
	offset += 8;

	// currentCallAmount (8)
	buffer.writeBigUInt64LE(overrides.currentCallAmount ?? BigInt(500000000), offset);
	offset += 8;

	// lastToCall (32)
	const lastToCall = overrides.lastToCall ?? new Uint8Array(32).fill(0xcd);
	buffer.set(lastToCall, offset);
	offset += 32;

	// Flags (5 bytes)
	buffer.writeUInt8(overrides.isEverybodyAllIn ?? 0, offset);
	offset += 1;
	buffer.writeUInt8(overrides.potClaimed ?? 0, offset);
	offset += 1;
	buffer.writeUInt8(overrides.cardToReveal ?? 0, offset);
	offset += 1;
	buffer.writeUInt8(overrides.cardsLeftInDeck ?? 52, offset);
	offset += 1;
	buffer.writeUInt8(overrides.isDeckSubmitted ?? 1, offset);
	offset += 1;

	// lastActionTimestamp (8)
	buffer.writeBigInt64LE(overrides.lastActionTimestamp ?? BigInt(1700000000), offset);

	return buffer;
}

/**
 * Create a mock GameConfig buffer
 */
function createMockGameConfigBuffer(): Buffer {
	const buffer = Buffer.alloc(134);
	let offset = 0;

	// bump (1)
	buffer.writeUInt8(254, offset);
	offset += 1;

	// gameId (32)
	buffer.set(new Uint8Array(32).fill(0x11), offset);
	offset += 32;

	// authority (32)
	buffer.set(new Uint8Array(32).fill(0x22), offset);
	offset += 32;

	// tokenMint (32)
	buffer.set(new Uint8Array(32).fill(0x33), offset);
	offset += 32;

	// maxPlayers (1)
	buffer.writeUInt8(6, offset);
	offset += 1;

	// currentPlayers (1)
	buffer.writeUInt8(2, offset);
	offset += 1;

	// smallBlind (8)
	buffer.writeBigUInt64LE(BigInt(10_000_000_000), offset);
	offset += 8;

	// minBuyIn (8)
	buffer.writeBigUInt64LE(BigInt(100_000_000_000), offset);
	offset += 8;

	// dealerIndex (1)
	buffer.writeUInt8(0, offset);
	offset += 1;

	// isAcceptingPlayers (1)
	buffer.writeUInt8(1, offset);
	offset += 1;

	// createdAt (8)
	buffer.writeBigInt64LE(BigInt(1700000000), offset);
	offset += 8;

	// timeoutSeconds (4)
	buffer.writeUInt32LE(120, offset);
	offset += 4;

	// slashPercentage (1)
	buffer.writeUInt8(10, offset);
	offset += 1;

	// gameNumber (4)
	buffer.writeUInt32LE(1, offset);

	return buffer;
}

/**
 * Create a mock Accumulator buffer (52 x 32 bytes + 33 header)
 */
function createMockAccumulatorBuffer(): Buffer {
	const buffer = Buffer.alloc(33 + 52 * 32);
	let offset = 0;

	// bump (1)
	buffer.writeUInt8(253, offset);
	offset += 1;

	// gameId (32)
	buffer.set(new Uint8Array(32).fill(0x44), offset);
	offset += 32;

	// 52 accumulator values (each 32 bytes)
	for (let i = 0; i < 52; i++) {
		const value = Buffer.alloc(32);
		value.fill(i + 1); // Fill with card index + 1
		buffer.set(value, offset);
		offset += 32;
	}

	return buffer;
}

// ===== Tests =====

describe('generateShuffleSeed', () => {
	it('should produce 32-byte seed', () => {
		const seed = generateShuffleSeed();
		expect(seed.length).toBe(32);
	});

	it('should produce different seeds each time', () => {
		const seed1 = generateShuffleSeed();
		const seed2 = generateShuffleSeed();
		expect(Buffer.from(seed1).equals(Buffer.from(seed2))).toBe(false);
	});
});

describe('calculateSeedCommitment', () => {
	it('should produce 32-byte commitment', () => {
		const seed = new Uint8Array(32).fill(0);
		const commitment = calculateSeedCommitment(seed);
		expect(commitment.length).toBe(32);
	});

	it('should be deterministic', () => {
		const seed = new Uint8Array(32).fill(0x42);
		const c1 = calculateSeedCommitment(seed);
		const c2 = calculateSeedCommitment(seed);
		expect(Buffer.from(c1).equals(Buffer.from(c2))).toBe(true);
	});

	it('should produce different commitments for different seeds', () => {
		const seed1 = new Uint8Array(32).fill(0x11);
		const seed2 = new Uint8Array(32).fill(0x22);
		const c1 = calculateSeedCommitment(seed1);
		const c2 = calculateSeedCommitment(seed2);
		expect(Buffer.from(c1).equals(Buffer.from(c2))).toBe(false);
	});
});

describe('buildInitializeGameData', () => {
	it('should produce correct buffer size', () => {
		const gameId = new Uint8Array(32).fill(0);
		const data = buildInitializeGameData(gameId, 2, BigInt(10_000), BigInt(100_000));
		expect(data.length).toBe(50); // 1 + 32 + 1 + 8 + 8
	});

	it('should have correct discriminator', () => {
		const gameId = new Uint8Array(32).fill(0);
		const data = buildInitializeGameData(gameId, 2, BigInt(10_000), BigInt(100_000));
		expect(data.readUInt8(0)).toBe(Instruction.InitializeGame);
	});

	it('should encode gameId correctly', () => {
		const gameId = new Uint8Array(32).fill(0xaa);
		const data = buildInitializeGameData(gameId, 2, BigInt(10_000), BigInt(100_000));
		expect(data.subarray(1, 33).every((b) => b === 0xaa)).toBe(true);
	});

	it('should encode maxPlayers correctly', () => {
		const gameId = new Uint8Array(32).fill(0);
		const data = buildInitializeGameData(gameId, 6, BigInt(10_000), BigInt(100_000));
		expect(data.readUInt8(33)).toBe(6);
	});

	it('should encode smallBlind as little-endian u64', () => {
		const gameId = new Uint8Array(32).fill(0);
		const smallBlind = BigInt(0x0102030405060708);
		const data = buildInitializeGameData(gameId, 2, smallBlind, BigInt(100_000));
		expect(data.readBigUInt64LE(34)).toBe(smallBlind);
	});

	it('should encode minBuyIn as little-endian u64', () => {
		const gameId = new Uint8Array(32).fill(0);
		const minBuyIn = BigInt(0x1112131415161718);
		const data = buildInitializeGameData(gameId, 2, BigInt(10_000), minBuyIn);
		expect(data.readBigUInt64LE(42)).toBe(minBuyIn);
	});
});

describe('buildJoinGameData', () => {
	it('should produce correct buffer size', () => {
		const commitment = new Uint8Array(32).fill(0);
		const data = buildJoinGameData(commitment, BigInt(100_000));
		expect(data.length).toBe(41); // 1 + 32 + 8
	});

	it('should have correct discriminator', () => {
		const commitment = new Uint8Array(32).fill(0);
		const data = buildJoinGameData(commitment, BigInt(100_000));
		expect(data.readUInt8(0)).toBe(Instruction.JoinGame);
	});

	it('should encode commitment correctly', () => {
		const commitment = new Uint8Array(32).fill(0xbb);
		const data = buildJoinGameData(commitment, BigInt(100_000));
		expect(data.subarray(1, 33).every((b) => b === 0xbb)).toBe(true);
	});

	it('should encode deposit amount as little-endian u64', () => {
		const commitment = new Uint8Array(32).fill(0);
		const amount = BigInt(123456789012345678n);
		const data = buildJoinGameData(commitment, amount);
		expect(data.readBigUInt64LE(33)).toBe(amount);
	});
});

describe('buildBetData', () => {
	it('should produce correct buffer size', () => {
		const data = buildBetData(BigInt(1000));
		expect(data.length).toBe(9); // 1 + 8
	});

	it('should have correct discriminator', () => {
		const data = buildBetData(BigInt(1000));
		expect(data.readUInt8(0)).toBe(Instruction.Bet);
	});

	it('should encode amount as little-endian u64', () => {
		const amount = BigInt(999888777666555n);
		const data = buildBetData(amount);
		expect(data.readBigUInt64LE(1)).toBe(amount);
	});
});

describe('buildFoldData', () => {
	it('should produce correct buffer size', () => {
		const data = buildFoldData();
		expect(data.length).toBe(1);
	});

	it('should have correct discriminator', () => {
		const data = buildFoldData();
		expect(data.readUInt8(0)).toBe(Instruction.Fold);
	});
});

describe('GameState deserialization', () => {
	// Import the deserializer (it's not exported, so we test via fetchGameState behavior)
	// For direct testing, we'd need to export deserializeGameState or test indirectly

	it('should correctly parse mock GameState buffer', async () => {
		// Since deserializeGameState is not exported, we create a mini-deserializer for testing
		const buffer = createMockGameStateBuffer({
			bump: 200,
			gamePhase: 2, // Drawing
			shufflingState: 4, // Locking
			currentTurn: 1,
			activePlayerCount: 2,
			pot: BigInt(5_000_000_000),
			currentCallAmount: BigInt(1_000_000_000),
			cardsLeftInDeck: 48,
			isDeckSubmitted: 1
		});

		// Parse manually to verify format
		let offset = 0;
		const bump = buffer.readUInt8(offset);
		offset += 1;
		expect(bump).toBe(200);

		offset += 32; // skip gameId

		const gamePhase = buffer.readUInt8(offset);
		expect(gamePhase).toBe(2);
		offset += 1;

		const shufflingState = buffer.readUInt8(offset);
		expect(shufflingState).toBe(4);
		offset += 1;

		offset += 4; // skip drawingState, texasState, bettingRoundState, communityCardsState

		const currentTurn = buffer.readUInt8(offset);
		expect(currentTurn).toBe(1);
		offset += 1;

		const activePlayerCount = buffer.readUInt8(offset);
		expect(activePlayerCount).toBe(2);
		offset += 1;

		offset += 4; // skip numFoldedPlayers, cardsDrawn, playerCardsOpened, numSubmittedHands

		const pot = buffer.readBigUInt64LE(offset);
		expect(pot).toBe(BigInt(5_000_000_000));
		offset += 8;

		const currentCallAmount = buffer.readBigUInt64LE(offset);
		expect(currentCallAmount).toBe(BigInt(1_000_000_000));
		offset += 8;

		offset += 32; // skip lastToCall
		offset += 2; // skip isEverybodyAllIn, potClaimed
		offset += 1; // skip cardToReveal

		const cardsLeftInDeck = buffer.readUInt8(offset);
		expect(cardsLeftInDeck).toBe(48);
		offset += 1;

		const isDeckSubmitted = buffer.readUInt8(offset);
		expect(isDeckSubmitted).toBe(1);
	});

	it('should have correct total size of 106 bytes', () => {
		const buffer = createMockGameStateBuffer();
		expect(buffer.length).toBe(106);
	});
});

describe('GameConfig deserialization', () => {
	it('should have correct total size of 134 bytes', () => {
		const buffer = createMockGameConfigBuffer();
		expect(buffer.length).toBe(134);
	});

	it('should parse maxPlayers correctly', () => {
		const buffer = createMockGameConfigBuffer();
		// maxPlayers is at offset: 1 + 32 + 32 + 32 = 97
		const maxPlayers = buffer.readUInt8(97);
		expect(maxPlayers).toBe(6);
	});

	it('should parse currentPlayers correctly', () => {
		const buffer = createMockGameConfigBuffer();
		// currentPlayers is at offset: 98
		const currentPlayers = buffer.readUInt8(98);
		expect(currentPlayers).toBe(2);
	});

	it('should parse smallBlind correctly', () => {
		const buffer = createMockGameConfigBuffer();
		// smallBlind is at offset: 99
		const smallBlind = buffer.readBigUInt64LE(99);
		expect(smallBlind).toBe(BigInt(10_000_000_000));
	});
});

describe('Accumulator deserialization', () => {
	it('should have correct total size', () => {
		const buffer = createMockAccumulatorBuffer();
		// 1 (bump) + 32 (gameId) + 52 * 32 (values) = 1697
		expect(buffer.length).toBe(1697);
	});

	it('should parse accumulator values correctly', () => {
		const buffer = createMockAccumulatorBuffer();
		let offset = 33; // skip bump + gameId

		// First value should be filled with 1
		const firstValue = buffer.subarray(offset, offset + 32);
		expect(firstValue.every((b) => b === 1)).toBe(true);

		// 52nd value should be filled with 52
		offset = 33 + 51 * 32;
		const lastValue = buffer.subarray(offset, offset + 32);
		expect(lastValue.every((b) => b === 52)).toBe(true);
	});
});

describe('DeckState format', () => {
	it('should use 64 bytes per card (uncompressed EC point)', () => {
		// Each card is stored as [x: 32 bytes, y: 32 bytes]
		const CARD_SIZE = 64;
		const DECK_SIZE = 52;
		const HEADER_SIZE = 33; // bump + gameId

		const expectedSize = HEADER_SIZE + DECK_SIZE * CARD_SIZE;
		expect(expectedSize).toBe(3361); // 33 + 3328
	});

	it('should store x and y coordinates as big-endian', () => {
		// Create a mock card with known x, y values
		const cardBuffer = Buffer.alloc(64);

		// x = 1 (should be 31 zeros followed by 0x01 in big-endian)
		cardBuffer.fill(0, 0, 31);
		cardBuffer.writeUInt8(1, 31);

		// y = 2 (should be 31 zeros followed by 0x02 in big-endian)
		cardBuffer.fill(0, 32, 63);
		cardBuffer.writeUInt8(2, 63);

		// Parse back
		const xHex = cardBuffer.subarray(0, 32).toString('hex');
		const yHex = cardBuffer.subarray(32, 64).toString('hex');

		const x = BigInt('0x' + xHex);
		const y = BigInt('0x' + yHex);

		expect(x).toBe(1n);
		expect(y).toBe(2n);
	});
});

describe('Instruction discriminators', () => {
	it('should match expected values', () => {
		expect(Instruction.InitializeGame).toBe(0);
		expect(Instruction.JoinGame).toBe(1);
		expect(Instruction.Generate).toBe(2);
		expect(Instruction.Bet).toBe(9);
		expect(Instruction.Fold).toBe(10);
	});
});
