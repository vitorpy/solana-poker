/**
 * Game session state management for Solana Poker
 */

import { writable, derived, get } from 'svelte/store';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { RPC_ENDPOINT, GamePhase, ShufflingState } from './constants';
import { deriveAllGameAccounts, type GameAccounts } from './pda';
import {
	initializeGame as initializeGameAction,
	joinGame as joinGameAction,
	betAction,
	foldAction,
	fetchGameConfig,
	fetchGameState,
	fetchPlayerState,
	fetchPlayerList,
	fetchAccumulator,
	fetchDeckState,
	generateAction,
	mapDeckAction,
	shuffleAction,
	lockAction,
	drawAction,
	revealAction,
	placeBlindAction,
	openAction,
	dealCommunityAction,
	openCommunityCardAction,
	type GameConfigData,
	type GameStateData,
	type PlayerStateData,
	type DeckStateData
} from './actions';
import { wallet } from '$lib/wallet/store';
import {
	generateLockVector,
	generateWorkDeck,
	randomUint256,
	Bn254Point,
	tupleToPoint,
	type PointTuple
} from './crypto';

/**
 * Game session state
 */
export interface GameSession {
	// Game identification
	gameId: Uint8Array | null;
	gameIdBase58: string | null;
	accounts: GameAccounts | null;

	// Player's local secrets (not stored on-chain)
	shuffleSeed: Uint8Array | null;
	lockVector: string[] | null; // 52 random lock values for each card
	shuffleKey: string | null; // Player's shuffle encryption key

	// Protocol state tracking
	originalWorkDeck: Bn254Point[] | null; // For card identification after reveal
	currentWorkDeck: Bn254Point[] | null; // Current state of the deck

	// Fetched on-chain state
	gameConfig: GameConfigData | null;
	gameState: GameStateData | null;
	playerState: PlayerStateData | null;
	playerList: PublicKey[] | null;
	deckState: DeckStateData | null;
	accumulator: string[] | null;

	// UI state
	isLoading: boolean;
	error: string | null;
	isInGame: boolean;
	protocolStatus: string | null; // Human-readable status of current protocol phase
}

const initialState: GameSession = {
	gameId: null,
	gameIdBase58: null,
	accounts: null,
	shuffleSeed: null,
	lockVector: null,
	shuffleKey: null,
	originalWorkDeck: null,
	currentWorkDeck: null,
	gameConfig: null,
	gameState: null,
	playerState: null,
	playerList: null,
	deckState: null,
	accumulator: null,
	isLoading: false,
	error: null,
	isInGame: false,
	protocolStatus: null
};

// Create the connection
const connection = new Connection(RPC_ENDPOINT, 'confirmed');

/**
 * Create the game store
 */
function createGameStore() {
	const { subscribe, set, update } = writable<GameSession>(initialState);

	let pollInterval: ReturnType<typeof setInterval> | null = null;

	return {
		subscribe,
		connection,

		/**
		 * Create a new game table and join it
		 */
		createGame: async (
			maxPlayers: number = 2,
			smallBlind: bigint = BigInt(10_000_000), // 0.01 SOL
			minBuyIn: bigint = BigInt(100_000_000) // 0.1 SOL
		) => {
			const walletState = get(wallet);
			if (!walletState.keypair) {
				update((s) => ({ ...s, error: 'Wallet not connected' }));
				return null;
			}

			update((s) => ({ ...s, isLoading: true, error: null }));

			try {
				// Step 1: Create the game
				const accounts = await initializeGameAction(
					connection,
					walletState.keypair,
					maxPlayers,
					smallBlind,
					minBuyIn
				);

				const gameIdBase58 = bs58.encode(accounts.gameId);
				console.log('[createGame] Game created:', gameIdBase58);

				// Step 2: Join the game as the first player
				console.log('[createGame] Joining game with buy-in:', minBuyIn.toString());
				const { shuffleSeed } = await joinGameAction(
					connection,
					walletState.keypair,
					accounts.gameId,
					minBuyIn
				);
				console.log('[createGame] Joined game successfully');

				// Generate lock vector and shuffle key for later use
				const lockVector = generateLockVector();
				const shuffleKey = randomUint256();

				update((s) => ({
					...s,
					gameId: accounts.gameId,
					gameIdBase58,
					accounts,
					shuffleSeed,
					lockVector,
					shuffleKey,
					isLoading: false,
					isInGame: true
				}));

				// Start polling for state updates
				startPolling();

				// Fetch initial state
				await refreshState();

				return gameIdBase58;
			} catch (error) {
				console.error('[createGame] Error:', error);
				const errorMsg = error instanceof Error ? error.message : 'Failed to create game';
				update((s) => ({ ...s, isLoading: false, error: errorMsg }));
				return null;
			}
		},

		/**
		 * Join an existing game
		 */
		joinGame: async (gameIdBase58: string, depositAmount: bigint = BigInt(100_000_000)) => {
			const walletState = get(wallet);
			if (!walletState.keypair) {
				update((s) => ({ ...s, error: 'Wallet not connected' }));
				return false;
			}

			update((s) => ({ ...s, isLoading: true, error: null }));

			try {
				const gameId = bs58.decode(gameIdBase58);
				const accounts = deriveAllGameAccounts(gameId);

				// First verify the game exists and is accepting players
				const gameConfig = await fetchGameConfig(connection, gameId);
				if (!gameConfig) {
					throw new Error('Game not found');
				}
				if (!gameConfig.isAcceptingPlayers) {
					throw new Error('Game is not accepting players');
				}

				// Join the game
				const { shuffleSeed, playerState } = await joinGameAction(
					connection,
					walletState.keypair,
					gameId,
					depositAmount
				);

				// Generate lock vector and shuffle key for later use
				const lockVector = generateLockVector();
				const shuffleKey = randomUint256();

				update((s) => ({
					...s,
					gameId,
					gameIdBase58,
					accounts,
					shuffleSeed,
					lockVector,
					shuffleKey,
					isLoading: false,
					isInGame: true
				}));

				// Start polling for state updates
				startPolling();

				// Fetch initial state
				await refreshState();

				return true;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Failed to join game';
				update((s) => ({ ...s, isLoading: false, error: errorMsg }));
				return false;
			}
		},

		/**
		 * Lookup a game without joining
		 */
		lookupGame: async (gameIdBase58: string): Promise<GameConfigData | null> => {
			try {
				const gameId = bs58.decode(gameIdBase58);
				return await fetchGameConfig(connection, gameId);
			} catch {
				return null;
			}
		},

		/**
		 * Leave the current game
		 */
		leaveGame: () => {
			stopPolling();
			set(initialState);
		},

		/**
		 * Clear any errors
		 */
		clearError: () => {
			update((s) => ({ ...s, error: null }));
		},

		/**
		 * Place a bet (call or raise)
		 */
		bet: async (amount: bigint) => {
			const walletState = get(wallet);
			const state = get({ subscribe });

			if (!walletState.keypair || !state.gameId) {
				update((s) => ({ ...s, error: 'Not in a game or wallet not connected' }));
				return false;
			}

			update((s) => ({ ...s, isLoading: true, error: null }));

			try {
				await betAction(connection, walletState.keypair, state.gameId, amount);
				await refreshState();
				update((s) => ({ ...s, isLoading: false }));
				return true;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Failed to place bet';
				update((s) => ({ ...s, isLoading: false, error: errorMsg }));
				return false;
			}
		},

		/**
		 * Fold the current hand
		 */
		fold: async () => {
			const walletState = get(wallet);
			const state = get({ subscribe });

			if (!walletState.keypair || !state.gameId) {
				update((s) => ({ ...s, error: 'Not in a game or wallet not connected' }));
				return false;
			}

			update((s) => ({ ...s, isLoading: true, error: null }));

			try {
				await foldAction(connection, walletState.keypair, state.gameId);
				await refreshState();
				update((s) => ({ ...s, isLoading: false }));
				return true;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Failed to fold';
				update((s) => ({ ...s, isLoading: false, error: errorMsg }));
				return false;
			}
		},

		/**
		 * Check (bet 0 when no one has bet)
		 */
		check: async () => {
			const walletState = get(wallet);
			const state = get({ subscribe });

			if (!walletState.keypair || !state.gameId) {
				update((s) => ({ ...s, error: 'Not in a game or wallet not connected' }));
				return false;
			}

			update((s) => ({ ...s, isLoading: true, error: null }));

			try {
				await betAction(connection, walletState.keypair, state.gameId, BigInt(0));
				await refreshState();
				update((s) => ({ ...s, isLoading: false }));
				return true;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Failed to check';
				update((s) => ({ ...s, isLoading: false, error: errorMsg }));
				return false;
			}
		},

		/**
		 * Call the current bet
		 */
		call: async () => {
			const walletState = get(wallet);
			const state = get({ subscribe });

			if (!walletState.keypair || !state.gameId || !state.gameState || !state.playerState) {
				update((s) => ({ ...s, error: 'Not in a game or wallet not connected' }));
				return false;
			}

			// Calculate call amount (current call amount - what we've already bet)
			const callAmount = state.gameState.currentCallAmount - state.playerState.currentBet;

			update((s) => ({ ...s, isLoading: true, error: null }));

			try {
				await betAction(connection, walletState.keypair, state.gameId, callAmount);
				await refreshState();
				update((s) => ({ ...s, isLoading: false }));
				return true;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Failed to call';
				update((s) => ({ ...s, isLoading: false, error: errorMsg }));
				return false;
			}
		},

		// ============== Protocol Actions ==============

		/**
		 * Submit shuffle seed (Generate phase)
		 * Reveals our commitment and contributes to the accumulator
		 */
		generate: async () => {
			const walletState = get(wallet);
			const state = get({ subscribe });

			if (!walletState.keypair || !state.gameId || !state.shuffleSeed) {
				update((s) => ({ ...s, error: 'Missing game state or shuffle seed' }));
				return false;
			}

			update((s) => ({ ...s, isLoading: true, error: null, protocolStatus: 'Submitting shuffle seed...' }));

			try {
				await generateAction(connection, walletState.keypair, state.gameId, state.shuffleSeed);
				await refreshState();
				update((s) => ({ ...s, isLoading: false, protocolStatus: 'Shuffle seed submitted' }));
				return true;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Failed to generate';
				update((s) => ({ ...s, isLoading: false, error: errorMsg, protocolStatus: null }));
				return false;
			}
		},

		/**
		 * Map the original deck (after Generate phase completes)
		 * First player builds and submits the initial work deck from accumulator
		 */
		mapDeck: async () => {
			const walletState = get(wallet);
			const state = get({ subscribe });

			if (!walletState.keypair || !state.gameId) {
				update((s) => ({ ...s, error: 'Missing game state' }));
				return false;
			}

			update((s) => ({ ...s, isLoading: true, error: null, protocolStatus: 'Mapping deck...' }));

			try {
				// Fetch accumulator from chain
				const accumulator = await fetchAccumulator(connection, state.gameId);
				if (!accumulator) {
					throw new Error('Accumulator not found');
				}

				// Generate work deck from accumulator
				const workDeck = generateWorkDeck(accumulator);

				// Submit to chain
				await mapDeckAction(connection, walletState.keypair, state.gameId, workDeck);

				// Store original work deck for card identification
				update((s) => ({
					...s,
					originalWorkDeck: workDeck,
					currentWorkDeck: workDeck,
					accumulator,
					isLoading: false,
					protocolStatus: 'Deck mapped'
				}));

				await refreshState();
				return true;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Failed to map deck';
				update((s) => ({ ...s, isLoading: false, error: errorMsg, protocolStatus: null }));
				return false;
			}
		},

		/**
		 * Shuffle and encrypt the deck
		 */
		shuffle: async () => {
			const walletState = get(wallet);
			const state = get({ subscribe });

			if (!walletState.keypair || !state.gameId || !state.shuffleKey) {
				update((s) => ({ ...s, error: 'Missing game state or shuffle key' }));
				return false;
			}

			update((s) => ({ ...s, isLoading: true, error: null, protocolStatus: 'Shuffling deck...' }));

			try {
				// Get current deck from chain
				const deckState = await fetchDeckState(connection, state.gameId);
				if (!deckState) {
					throw new Error('Deck state not found');
				}

				// Convert on-chain points to Bn254Point array
				const currentDeck = deckState.cards.map((card) => tupleToPoint(card as PointTuple));

				// Shuffle and encrypt
				const shuffledDeck = await shuffleAction(
					connection,
					walletState.keypair,
					state.gameId,
					currentDeck,
					state.shuffleKey
				);

				update((s) => ({
					...s,
					currentWorkDeck: shuffledDeck,
					isLoading: false,
					protocolStatus: 'Deck shuffled'
				}));

				await refreshState();
				return true;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Failed to shuffle';
				update((s) => ({ ...s, isLoading: false, error: errorMsg, protocolStatus: null }));
				return false;
			}
		},

		/**
		 * Lock the deck with per-card lock values
		 */
		lock: async () => {
			const walletState = get(wallet);
			const state = get({ subscribe });

			if (!walletState.keypair || !state.gameId || !state.lockVector) {
				update((s) => ({ ...s, error: 'Missing game state or lock vector' }));
				return false;
			}

			update((s) => ({ ...s, isLoading: true, error: null, protocolStatus: 'Locking cards...' }));

			try {
				// Get current deck from chain
				const deckState = await fetchDeckState(connection, state.gameId);
				if (!deckState) {
					throw new Error('Deck state not found');
				}

				// Convert on-chain points to Bn254Point array
				const currentDeck = deckState.cards.map((card) => tupleToPoint(card as PointTuple));

				// Apply locks
				const lockedDeck = await lockAction(
					connection,
					walletState.keypair,
					state.gameId,
					currentDeck,
					state.lockVector
				);

				update((s) => ({
					...s,
					currentWorkDeck: lockedDeck,
					isLoading: false,
					protocolStatus: 'Cards locked'
				}));

				await refreshState();
				return true;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Failed to lock';
				update((s) => ({ ...s, isLoading: false, error: errorMsg, protocolStatus: null }));
				return false;
			}
		},

		/**
		 * Draw a card
		 */
		draw: async () => {
			const walletState = get(wallet);
			const state = get({ subscribe });

			if (!walletState.keypair || !state.gameId) {
				update((s) => ({ ...s, error: 'Missing game state' }));
				return false;
			}

			update((s) => ({ ...s, isLoading: true, error: null, protocolStatus: 'Drawing card...' }));

			try {
				await drawAction(connection, walletState.keypair, state.gameId);
				await refreshState();
				update((s) => ({ ...s, isLoading: false, protocolStatus: 'Card drawn' }));
				return true;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Failed to draw';
				update((s) => ({ ...s, isLoading: false, error: errorMsg, protocolStatus: null }));
				return false;
			}
		},

		/**
		 * Reveal (decrypt) another player's drawn card
		 */
		reveal: async (cardIndex: number) => {
			const walletState = get(wallet);
			const state = get({ subscribe });

			if (!walletState.keypair || !state.gameId || !state.lockVector) {
				update((s) => ({ ...s, error: 'Missing game state or lock vector' }));
				return false;
			}

			update((s) => ({ ...s, isLoading: true, error: null, protocolStatus: 'Revealing card...' }));

			try {
				const lockKey = state.lockVector[cardIndex];
				await revealAction(connection, walletState.keypair, state.gameId, cardIndex, lockKey);
				await refreshState();
				update((s) => ({ ...s, isLoading: false, protocolStatus: 'Card revealed' }));
				return true;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Failed to reveal';
				update((s) => ({ ...s, isLoading: false, error: errorMsg, protocolStatus: null }));
				return false;
			}
		},

		/**
		 * Place blind bet
		 */
		placeBlind: async (amount: bigint) => {
			const walletState = get(wallet);
			const state = get({ subscribe });

			if (!walletState.keypair || !state.gameId) {
				update((s) => ({ ...s, error: 'Missing game state' }));
				return false;
			}

			update((s) => ({ ...s, isLoading: true, error: null, protocolStatus: 'Placing blind...' }));

			try {
				await placeBlindAction(connection, walletState.keypair, state.gameId, amount);
				await refreshState();
				update((s) => ({ ...s, isLoading: false, protocolStatus: 'Blind placed' }));
				return true;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Failed to place blind';
				update((s) => ({ ...s, isLoading: false, error: errorMsg, protocolStatus: null }));
				return false;
			}
		},

		/**
		 * Open hole card for showdown
		 */
		open: async (cardIndex: number) => {
			const walletState = get(wallet);
			const state = get({ subscribe });

			if (!walletState.keypair || !state.gameId || !state.lockVector) {
				update((s) => ({ ...s, error: 'Missing game state or lock vector' }));
				return false;
			}

			update((s) => ({ ...s, isLoading: true, error: null, protocolStatus: 'Opening card...' }));

			try {
				const lockKey = state.lockVector[cardIndex];
				await openAction(connection, walletState.keypair, state.gameId, cardIndex, lockKey);
				await refreshState();
				update((s) => ({ ...s, isLoading: false, protocolStatus: 'Card opened' }));
				return true;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Failed to open card';
				update((s) => ({ ...s, isLoading: false, error: errorMsg, protocolStatus: null }));
				return false;
			}
		},

		/**
		 * Deal community cards
		 */
		dealCommunity: async () => {
			const walletState = get(wallet);
			const state = get({ subscribe });

			if (!walletState.keypair || !state.gameId) {
				update((s) => ({ ...s, error: 'Missing game state' }));
				return false;
			}

			update((s) => ({ ...s, isLoading: true, error: null, protocolStatus: 'Dealing community card...' }));

			try {
				await dealCommunityAction(connection, walletState.keypair, state.gameId);
				await refreshState();
				update((s) => ({ ...s, isLoading: false, protocolStatus: 'Community card dealt' }));
				return true;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Failed to deal community card';
				update((s) => ({ ...s, isLoading: false, error: errorMsg, protocolStatus: null }));
				return false;
			}
		},

		/**
		 * Open community card
		 */
		openCommunityCard: async (cardIndex: number) => {
			const walletState = get(wallet);
			const state = get({ subscribe });

			if (!walletState.keypair || !state.gameId || !state.lockVector) {
				update((s) => ({ ...s, error: 'Missing game state or lock vector' }));
				return false;
			}

			update((s) => ({ ...s, isLoading: true, error: null, protocolStatus: 'Opening community card...' }));

			try {
				const lockKey = state.lockVector[cardIndex];
				await openCommunityCardAction(connection, walletState.keypair, state.gameId, cardIndex, lockKey);
				await refreshState();
				update((s) => ({ ...s, isLoading: false, protocolStatus: 'Community card opened' }));
				return true;
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : 'Failed to open community card';
				update((s) => ({ ...s, isLoading: false, error: errorMsg, protocolStatus: null }));
				return false;
			}
		}
	};

	/**
	 * Refresh game state from chain
	 */
	async function refreshState() {
		const state = get({ subscribe });
		if (!state.gameId) return;

		const walletState = get(wallet);

		try {
			const [gameConfig, gameState, playerList, deckState, accumulator] = await Promise.all([
				fetchGameConfig(connection, state.gameId),
				fetchGameState(connection, state.gameId),
				fetchPlayerList(connection, state.gameId),
				fetchDeckState(connection, state.gameId),
				fetchAccumulator(connection, state.gameId)
			]);

			let playerState: PlayerStateData | null = null;
			if (walletState.keypair) {
				playerState = await fetchPlayerState(
					connection,
					state.gameId,
					walletState.keypair.publicKey
				);
			}

			update((s) => ({
				...s,
				gameConfig,
				gameState,
				playerState,
				playerList,
				deckState,
				accumulator
			}));
		} catch (error) {
			console.error('Failed to refresh game state:', error);
		}
	}

	/**
	 * Start polling for state updates
	 */
	function startPolling() {
		if (pollInterval) return;

		pollInterval = setInterval(async () => {
			await refreshState();
		}, 2000);
	}

	/**
	 * Stop polling
	 */
	function stopPolling() {
		if (pollInterval) {
			clearInterval(pollInterval);
			pollInterval = null;
		}
	}
}

export const game = createGameStore();

// Derived stores for convenience
export const gameId = derived(game, ($game) => $game.gameIdBase58);
export const isInGame = derived(game, ($game) => $game.isInGame);
export const isLoading = derived(game, ($game) => $game.isLoading);
export const gameError = derived(game, ($game) => $game.error);
export const gameConfig = derived(game, ($game) => $game.gameConfig);
export const gameState = derived(game, ($game) => $game.gameState);
export const playerState = derived(game, ($game) => $game.playerState);

// Derived game phase info
export const currentPhase = derived(game, ($game) => {
	if (!$game.gameState) return null;
	return $game.gameState.gamePhase as GamePhase;
});

export const currentShufflingState = derived(game, ($game) => {
	if (!$game.gameState) return null;
	return $game.gameState.shufflingState as ShufflingState;
});

export const playersInGame = derived(game, ($game) => {
	if (!$game.gameConfig) return 0;
	return $game.gameConfig.currentPlayers;
});

export const maxPlayers = derived(game, ($game) => {
	if (!$game.gameConfig) return 2;
	return $game.gameConfig.maxPlayers;
});

export const isWaitingForPlayers = derived(game, ($game) => {
	if (!$game.gameConfig || !$game.gameState) return false;
	return (
		$game.gameState.shufflingState === ShufflingState.Committing &&
		$game.gameConfig.currentPlayers < $game.gameConfig.maxPlayers
	);
});

export const pot = derived(game, ($game) => {
	if (!$game.gameState) return BigInt(0);
	return $game.gameState.pot;
});

export const playerChips = derived(game, ($game) => {
	if (!$game.playerState) return BigInt(0);
	return $game.playerState.chips;
});

// Betting-related derived stores
export const currentCallAmount = derived(game, ($game) => {
	if (!$game.gameState) return BigInt(0);
	return $game.gameState.currentCallAmount;
});

export const playerCurrentBet = derived(game, ($game) => {
	if (!$game.playerState) return BigInt(0);
	return $game.playerState.currentBet;
});

export const amountToCall = derived(game, ($game) => {
	if (!$game.gameState || !$game.playerState) return BigInt(0);
	return $game.gameState.currentCallAmount - $game.playerState.currentBet;
});

export const isPlayerTurn = derived([game, wallet], ([$game, $wallet]) => {
	if (!$game.gameState || !$game.playerList || !$wallet.keypair) return false;

	const currentTurnIndex = $game.gameState.currentTurn;
	const currentPlayer = $game.playerList[currentTurnIndex];

	return currentPlayer?.equals($wallet.keypair.publicKey) ?? false;
});

export const canCheck = derived(game, ($game) => {
	if (!$game.gameState || !$game.playerState) return false;
	// Can check if current call amount equals our current bet
	return $game.gameState.currentCallAmount === $game.playerState.currentBet;
});

export const canCall = derived(game, ($game) => {
	if (!$game.gameState || !$game.playerState) return false;
	// Can call if current call amount is greater than our current bet
	return $game.gameState.currentCallAmount > $game.playerState.currentBet;
});

export const playerList = derived(game, ($game) => $game.playerList);

export const isFolded = derived(game, ($game) => {
	if (!$game.playerState) return false;
	return $game.playerState.isFolded;
});

export const texasState = derived(game, ($game) => {
	if (!$game.gameState) return null;
	return $game.gameState.texasState;
});

export const bettingRound = derived(game, ($game) => {
	if (!$game.gameState) return null;
	return $game.gameState.bettingRoundState;
});

// Protocol-related derived stores
export const protocolStatus = derived(game, ($game) => $game.protocolStatus);

export const deckState = derived(game, ($game) => $game.deckState);

export const accumulator = derived(game, ($game) => $game.accumulator);

export const lockVector = derived(game, ($game) => $game.lockVector);

export const shuffleSeed = derived(game, ($game) => $game.shuffleSeed);

export const hasCommitted = derived(game, ($game) => {
	if (!$game.playerState) return false;
	return $game.playerState.hasCommitted;
});

// Determine what action is required from this player based on game state
export const requiredAction = derived([game, wallet], ([$game, $wallet]) => {
	if (!$game.gameState || !$game.playerList || !$wallet.keypair) return null;

	const currentTurnIndex = $game.gameState.currentTurn;
	const currentPlayer = $game.playerList[currentTurnIndex];
	const isMyTurn = currentPlayer?.equals($wallet.keypair.publicKey) ?? false;

	const phase = $game.gameState.gamePhase as GamePhase;
	const shufflingState = $game.gameState.shufflingState as ShufflingState;

	// Check if in shuffling phase
	if (phase === GamePhase.Shuffling) {
		// Generating phase - submit shuffle seed
		if (shufflingState === ShufflingState.Generating && isMyTurn) {
			return { action: 'generate', description: 'Submit shuffle seed' };
		}
		// Shuffling phase - shuffle and encrypt
		if (shufflingState === ShufflingState.Shuffling && isMyTurn) {
			// Check if deck has been mapped
			if (!$game.gameState.isDeckSubmitted) {
				return { action: 'mapDeck', description: 'Map initial deck' };
			}
			return { action: 'shuffle', description: 'Shuffle deck' };
		}
		// Locking phase - apply lock vector
		if (shufflingState === ShufflingState.Locking && isMyTurn) {
			return { action: 'lock', description: 'Lock cards' };
		}
	}

	// Drawing phase
	if (phase === GamePhase.Drawing) {
		const drawingState = $game.gameState.drawingState;
		// 1 = Picking, 2 = Revealing
		if (drawingState === 1 && isMyTurn) {
			return { action: 'draw', description: 'Draw a card' };
		}
		if (drawingState === 2 && !isMyTurn) {
			// Need to reveal for the other player
			const cardToReveal = $game.gameState.cardToReveal;
			return { action: 'reveal', description: 'Reveal card', cardIndex: cardToReveal };
		}
	}

	return null;
});

// Derived store to get player's seat index
export const playerSeatIndex = derived(game, ($game) => {
	if (!$game.playerState) return null;
	return $game.playerState.seatIndex;
});

// Get the card that needs to be revealed (for draw phase)
export const cardToReveal = derived(game, ($game) => {
	if (!$game.gameState) return null;
	return $game.gameState.cardToReveal;
});
