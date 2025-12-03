/**
 * PDA derivation utilities for Solana Poker
 * Ported from tests/helpers/setup.ts
 */

import { PublicKey, Keypair } from '@solana/web3.js';
import {
	PROGRAM_ID,
	GAME_CONFIG_SEED,
	GAME_STATE_SEED,
	PLAYER_STATE_SEED,
	DECK_STATE_SEED,
	ACCUMULATOR_SEED,
	COMMUNITY_CARDS_SEED,
	VAULT_SEED,
	PLAYER_LIST_SEED
} from './constants';

/**
 * Game account structure containing all PDAs
 */
export interface GameAccounts {
	gameId: Uint8Array;
	gameConfig: PublicKey;
	gameConfigBump: number;
	gameState: PublicKey;
	gameStateBump: number;
	deckState: PublicKey;
	deckStateBump: number;
	accumulator: PublicKey;
	accumulatorBump: number;
	communityCards: PublicKey;
	communityCardsBump: number;
	playerList: PublicKey;
	playerListBump: number;
	vault: PublicKey;
	vaultBump: number;
}

/**
 * Derive game config PDA
 */
export function deriveGameConfig(
	gameId: Uint8Array,
	programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
	return PublicKey.findProgramAddressSync([GAME_CONFIG_SEED, gameId], programId);
}

/**
 * Derive game state PDA
 */
export function deriveGameState(
	gameId: Uint8Array,
	programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
	return PublicKey.findProgramAddressSync([GAME_STATE_SEED, gameId], programId);
}

/**
 * Derive player state PDA
 */
export function derivePlayerState(
	gameId: Uint8Array,
	player: PublicKey,
	programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[PLAYER_STATE_SEED, gameId, player.toBuffer()],
		programId
	);
}

/**
 * Derive deck state PDA
 */
export function deriveDeckState(
	gameId: Uint8Array,
	programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
	return PublicKey.findProgramAddressSync([DECK_STATE_SEED, gameId], programId);
}

/**
 * Derive accumulator PDA
 */
export function deriveAccumulator(
	gameId: Uint8Array,
	programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
	return PublicKey.findProgramAddressSync([ACCUMULATOR_SEED, gameId], programId);
}

/**
 * Derive community cards PDA
 */
export function deriveCommunityCards(
	gameId: Uint8Array,
	programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
	return PublicKey.findProgramAddressSync([COMMUNITY_CARDS_SEED, gameId], programId);
}

/**
 * Derive player list PDA
 */
export function derivePlayerList(
	gameId: Uint8Array,
	programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
	return PublicKey.findProgramAddressSync([PLAYER_LIST_SEED, gameId], programId);
}

/**
 * Derive vault PDA
 */
export function deriveVault(
	gameId: Uint8Array,
	programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
	return PublicKey.findProgramAddressSync([VAULT_SEED, gameId], programId);
}

/**
 * Generate a random 32-byte game ID
 */
export function generateGameId(): Uint8Array {
	return Keypair.generate().publicKey.toBytes();
}

/**
 * Derive all game accounts from a game ID
 */
export function deriveAllGameAccounts(
	gameId: Uint8Array,
	programId: PublicKey = PROGRAM_ID
): GameAccounts {
	const [gameConfig, gameConfigBump] = deriveGameConfig(gameId, programId);
	const [gameState, gameStateBump] = deriveGameState(gameId, programId);
	const [deckState, deckStateBump] = deriveDeckState(gameId, programId);
	const [accumulator, accumulatorBump] = deriveAccumulator(gameId, programId);
	const [communityCards, communityCardsBump] = deriveCommunityCards(gameId, programId);
	const [playerList, playerListBump] = derivePlayerList(gameId, programId);
	const [vault, vaultBump] = deriveVault(gameId, programId);

	return {
		gameId,
		gameConfig,
		gameConfigBump,
		gameState,
		gameStateBump,
		deckState,
		deckStateBump,
		accumulator,
		accumulatorBump,
		communityCards,
		communityCardsBump,
		playerList,
		playerListBump,
		vault,
		vaultBump
	};
}
