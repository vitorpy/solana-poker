/**
 * Integration test for the mental poker protocol
 *
 * Tests the full shuffle protocol flow against a local test validator.
 * Requires: solana-test-validator and cargo build-sbf to be run first.
 *
 * Run with: npm test -- --testTimeout=120000 integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Connection } from '@solana/web3.js';
import {
	startValidator,
	stopValidator,
	getConnection,
	createFundedPayer,
	getProgramId
} from './test-helpers/validator';
import {
	initializeGame,
	joinGame,
	generateAction,
	mapDeckAction,
	shuffleAction,
	lockAction,
	fetchGameState,
	fetchGameConfig,
	fetchAccumulator,
	fetchDeckState,
	generateShuffleSeed
} from './actions';
import { deriveAllGameAccounts, derivePlayerState, generateGameId, type GameAccounts } from './pda';
import {
	generateWorkDeck,
	generateLockVector,
	deriveAllShuffleValues,
	Bn254Point,
	randomUint256
} from './crypto';
import { PROGRAM_ID } from './constants';
import { GamePhase, ShufflingState } from './constants';

// Test configuration
const PLAYER_COUNT = 2;
const SMALL_BLIND = BigInt(10_000_000_000); // 10 SOL
const MIN_BUY_IN = BigInt(100_000_000_000); // 100 SOL
const BUY_IN_AMOUNT = BigInt(1000_000_000_000); // 1000 SOL

interface TestPlayer {
	keypair: Keypair;
	shuffleSeed: Uint8Array;
	shuffleVector: string[];
	lockVector: string[];
	shuffleKey: string;
	playerState: PublicKey;
}

describe('Mental Poker Protocol Integration', () => {
	let authority: Keypair;
	let gameAccounts: GameAccounts;
	let gameId: Uint8Array;
	let players: TestPlayer[] = [];

	// Crypto state
	let accumulator: string[] = [];
	let workDeck: Bn254Point[] = [];
	let originalWorkDeck: Bn254Point[] = [];

	beforeAll(async () => {
		// Start the test validator with the poker program
		await startValidator();

		// Create authority (game creator)
		authority = await createFundedPayer(100 * LAMPORTS_PER_SOL);
		console.log('Authority:', authority.publicKey.toBase58());
	}, 60000);

	afterAll(async () => {
		await stopValidator();
	}, 10000);

	describe('1. Game Setup', () => {
		it('should initialize a new game', async () => {
			const connection = getConnection();

			// Generate game ID and derive accounts
			gameId = generateGameId();
			gameAccounts = deriveAllGameAccounts(gameId, PROGRAM_ID);

			console.log('Game ID:', Buffer.from(gameId).toString('hex').slice(0, 16) + '...');
			console.log('GameConfig:', gameAccounts.gameConfig.toBase58());
			console.log('GameState:', gameAccounts.gameState.toBase58());

			// Initialize the game
			const result = await initializeGame(
				connection,
				authority,
				PLAYER_COUNT,
				SMALL_BLIND,
				MIN_BUY_IN
			);

			// Use returned accounts
			gameAccounts = result;

			// Verify game was created
			expect(gameAccounts.gameConfig).toBeDefined();
			expect(gameAccounts.gameState).toBeDefined();

			// Fetch and verify game config
			const config = await fetchGameConfig(connection, gameAccounts.gameId);
			expect(config).not.toBeNull();
			expect(config!.maxPlayers).toBe(PLAYER_COUNT);
			expect(config!.smallBlind).toBe(SMALL_BLIND);
			expect(config!.isAcceptingPlayers).toBe(true);
		});

		it('should allow players to join the game', async () => {
			const connection = getConnection();

			for (let i = 0; i < PLAYER_COUNT; i++) {
				// Create funded player
				const playerKeypair = await createFundedPayer(2000 * LAMPORTS_PER_SOL);

				// Join the game - this generates the shuffle seed and commitment
				const { signature, shuffleSeed, playerState } = await joinGame(
					connection,
					playerKeypair,
					gameAccounts.gameId,
					BUY_IN_AMOUNT
				);

				// Derive crypto material from the seed used in commitment
				const shuffleVector = deriveAllShuffleValues(shuffleSeed);
				const lockVector = generateLockVector();
				const shuffleKey = randomUint256();

				console.log(`Player ${i} joined: ${playerKeypair.publicKey.toBase58().slice(0, 8)}...`);
				console.log(`  Signature: ${signature.slice(0, 16)}...`);

				players.push({
					keypair: playerKeypair,
					shuffleSeed,
					shuffleVector,
					lockVector,
					shuffleKey,
					playerState
				});
			}

			// Verify all players joined
			expect(players.length).toBe(PLAYER_COUNT);

			// Fetch game config to check player count
			const config = await fetchGameConfig(connection, gameAccounts.gameId);
			expect(config!.currentPlayers).toBe(PLAYER_COUNT);
		});
	});

	describe('2. Shuffling Phase', () => {
		it('should verify game is in Shuffling phase', async () => {
			const connection = getConnection();
			const state = await fetchGameState(connection, gameAccounts.gameId);

			expect(state).not.toBeNull();
			console.log('Game phase:', state!.gamePhase);
			console.log('Shuffling state:', state!.shufflingState);

			// Game should be in Shuffling phase after players join
			expect(state!.gamePhase).toBe(GamePhase.Shuffling);
		});

		it('should generate shuffle vectors', async () => {
			const connection = getConnection();

			// Initialize accumulator
			accumulator = new Array(52).fill('0x0');

			// Fetch game state to see turn order
			const initialState = await fetchGameState(connection, gameAccounts.gameId);
			console.log(`Current turn starts at index: ${initialState!.currentTurn}`);

			// Each player submits their shuffle seed in turn order
			for (let i = 0; i < PLAYER_COUNT; i++) {
				// Calculate which player goes next based on current_turn
				const playerIndex = (initialState!.currentTurn + i) % PLAYER_COUNT;
				const player = players[playerIndex];

				console.log(`Player ${playerIndex} generating shuffle vector...`);

				// Submit the seed
				await generateAction(
					connection,
					player.keypair,
					gameAccounts.gameId,
					player.shuffleSeed
				);

				// Add to local accumulator (client-side tracking)
				for (let j = 0; j < 52; j++) {
					const current = BigInt(accumulator[j]);
					const addition = BigInt(player.shuffleVector[j]);
					accumulator[j] = '0x' + ((current + addition) % 2n ** 256n).toString(16);
				}
			}

			// Verify shuffling state moved to Shuffling
			const state = await fetchGameState(connection, gameAccounts.gameId);
			expect(state!.shufflingState).toBe(ShufflingState.Shuffling);

			// Fetch and verify on-chain accumulator
			const onChainAccumulator = await fetchAccumulator(connection, gameAccounts.gameId);
			expect(onChainAccumulator).not.toBeNull();
			expect(onChainAccumulator!.length).toBe(52);
		});

		it('should map the deck', async () => {
			const connection = getConnection();

			// Fetch accumulator from chain
			const onChainAccumulator = await fetchAccumulator(connection, gameAccounts.gameId);
			expect(onChainAccumulator).not.toBeNull();

			// Generate work deck from accumulator
			workDeck = generateWorkDeck(onChainAccumulator!);
			originalWorkDeck = [...workDeck]; // Save for card identification

			console.log('Generated work deck with', workDeck.length, 'cards');
			console.log(
				'First card point:',
				workDeck[0].getX().toString(16).slice(0, 16) + '...'
			);

			// Fetch game state to see whose turn it is
			const state = await fetchGameState(connection, gameAccounts.gameId);
			const mapPlayerIndex = state!.currentTurn;
			const mapPlayer = players[mapPlayerIndex];
			console.log(`Player ${mapPlayerIndex} mapping deck...`);

			await mapDeckAction(connection, mapPlayer.keypair, gameAccounts.gameId, workDeck);

			// Note: mapDeck stores the original deck in the accumulator for card identification.
			// The DeckState is only populated during shuffle phase.
			// Verify by checking game state progressed properly
			const mapState = await fetchGameState(connection, gameAccounts.gameId);
			expect(mapState!.shufflingState).toBe(ShufflingState.Shuffling);
			console.log('MapDeck complete, ready for shuffle');
		});

		it('should shuffle the deck', async () => {
			const connection = getConnection();

			// First shuffle uses workDeck from mapDeck phase, subsequent shuffles read from DeckState
			// Start with the workDeck we generated
			let currentDeck = [...workDeck];
			console.log('Starting shuffle with', currentDeck.length, 'cards from workDeck');

			// Fetch game state to see turn order
			const initialState = await fetchGameState(connection, gameAccounts.gameId);
			console.log(`Shuffle turn starts at index: ${initialState!.currentTurn}`);

			// Each player encrypts and shuffles in turn order
			for (let i = 0; i < PLAYER_COUNT; i++) {
				const playerIndex = (initialState!.currentTurn + i) % PLAYER_COUNT;
				const player = players[playerIndex];
				console.log(`Player ${playerIndex} shuffling...`);

				currentDeck = await shuffleAction(
					connection,
					player.keypair,
					gameAccounts.gameId,
					currentDeck,
					player.shuffleKey
				);
			}

			// Verify shuffling state moved to Locking
			const state = await fetchGameState(connection, gameAccounts.gameId);
			expect(state!.shufflingState).toBe(ShufflingState.Locking);

			// Update our work deck reference
			workDeck = currentDeck;
		});

		it('should lock the cards', async () => {
			const connection = getConnection();

			// Fetch current deck from chain
			const deckState = await fetchDeckState(connection, gameAccounts.gameId);
			expect(deckState).not.toBeNull();

			// Convert to Bn254Points
			let currentDeck = deckState!.cards.map((card) =>
				Bn254Point.fromCoords(BigInt(card.qx), BigInt(card.qy))
			);

			// Fetch game state to see turn order
			const initialState = await fetchGameState(connection, gameAccounts.gameId);
			console.log(`Lock turn starts at index: ${initialState!.currentTurn}`);

			// Each player applies their lock vector in turn order
			for (let i = 0; i < PLAYER_COUNT; i++) {
				const playerIndex = (initialState!.currentTurn + i) % PLAYER_COUNT;
				const player = players[playerIndex];
				console.log(`Player ${playerIndex} locking...`);

				currentDeck = await lockAction(
					connection,
					player.keypair,
					gameAccounts.gameId,
					currentDeck,
					player.lockVector
				);
			}

			// Verify game moved to Drawing phase
			const state = await fetchGameState(connection, gameAccounts.gameId);
			expect(state!.gamePhase).toBe(GamePhase.Drawing);

			// Update our work deck reference
			workDeck = currentDeck;
			console.log('Deck locked and ready for drawing!');
		});
	});

	describe('3. Drawing Phase', () => {
		it('should be in drawing phase', async () => {
			const connection = getConnection();
			const state = await fetchGameState(connection, gameAccounts.gameId);

			expect(state).not.toBeNull();
			expect(state!.gamePhase).toBe(GamePhase.Drawing);
			expect(state!.cardsLeftInDeck).toBe(52);

			console.log('Ready to draw cards!');
			console.log('Cards left in deck:', state!.cardsLeftInDeck);
		});

		// Additional drawing tests can be added here
	});
});

// Simpler test that doesn't require validator
describe('Protocol Crypto Operations (Unit)', () => {
	it('should generate consistent shuffle vectors from seed', () => {
		const seed = new Uint8Array(32).fill(0x42);
		const vectors1 = deriveAllShuffleValues(seed);
		const vectors2 = deriveAllShuffleValues(seed);

		expect(vectors1).toEqual(vectors2);
		expect(vectors1.length).toBe(52);
	});

	it('should generate work deck from accumulator', () => {
		const accumulator = Array.from({ length: 52 }, (_, i) => `0x${(i + 1).toString(16)}`);
		const deck = generateWorkDeck(accumulator);

		expect(deck.length).toBe(52);
		deck.forEach((point) => {
			expect(point.isInfinity()).toBe(false);
		});
	});

	it('should generate 52 unique lock values', () => {
		const lock = generateLockVector();
		const uniqueValues = new Set(lock);

		expect(lock.length).toBe(52);
		// Should be highly likely all unique (random 256-bit values)
		expect(uniqueValues.size).toBe(52);
	});
});
