/**
 * Game constants and enums for Solana Poker
 * Matching Rust program definitions
 */

import { PublicKey } from '@solana/web3.js';
import { NATIVE_MINT } from '@solana/spl-token';

// Program ID from environment variable
export const PROGRAM_ID = new PublicKey(
	import.meta.env.VITE_PROGRAM_ID || '11111111111111111111111111111111'
);
export const RPC_ENDPOINT = import.meta.env.VITE_RPC_ENDPOINT || 'http://localhost:8899';

// WSOL mint (native SOL wrapped)
export const TOKEN_MINT = NATIVE_MINT;

// PDA Seeds (matching src/constants.rs)
export const GAME_CONFIG_SEED = new TextEncoder().encode('game_config');
export const GAME_STATE_SEED = new TextEncoder().encode('game_state');
export const PLAYER_STATE_SEED = new TextEncoder().encode('player');
export const DECK_STATE_SEED = new TextEncoder().encode('deck');
export const ACCUMULATOR_SEED = new TextEncoder().encode('accumulator');
export const COMMUNITY_CARDS_SEED = new TextEncoder().encode('community');
export const VAULT_SEED = new TextEncoder().encode('vault');
export const PLAYER_LIST_SEED = new TextEncoder().encode('player_list');

// Account sizes (matching Rust state structs)
export const GAME_CONFIG_SIZE = 134;
export const GAME_STATE_SIZE = 125;
export const PLAYER_STATE_SIZE = 256;
export const DECK_STATE_SIZE = 5025;
export const ACCUMULATOR_STATE_SIZE = 5025;
export const COMMUNITY_CARDS_SIZE = 360;
export const PLAYER_LIST_SIZE = 227;

// Game constants
export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 2;
export const DECK_SIZE = 52;
export const HOLE_CARDS_PER_PLAYER = 2;
export const MAX_COMMUNITY_CARDS = 5;
export const TOKEN_DECIMALS = 9;

// Instruction discriminators (matching processor.rs)
export enum Instruction {
	InitializeGame = 0,
	JoinGame = 1,
	Generate = 2,
	MapDeck = 3,
	ShuffleDeck = 4,
	LockCards = 5,
	Draw = 6,
	RevealCard = 7,
	PlaceBlind = 8,
	Bet = 9,
	Fold = 10,
	DealCommunityCard = 11,
	OpenCommunityCard = 12,
	OpenCard = 13,
	SubmitBestHand = 14,
	ClaimPot = 15,
	StartNextGame = 16,
	Leave = 17,
	Slash = 18,
	CloseGame = 19,
	ShufflePart1 = 20,
	ShufflePart2 = 21,
	LockPart1 = 22,
	LockPart2 = 23,
	MapDeckPart1 = 25,
	MapDeckPart2 = 26
}

// Major game phases for the mental poker protocol
export enum GamePhase {
	WaitingForPlayers = 0,
	Shuffling = 1,
	Drawing = 2,
	Opening = 3,
	Finished = 4
}

// Substate for the shuffling subprotocol
export enum ShufflingState {
	NotStarted = 0,
	Committing = 1,
	Generating = 2,
	Shuffling = 3,
	Locking = 4
}

// Substate for the drawing subprotocol
export enum DrawingState {
	NotDrawn = 0,
	Picking = 1,
	Revealing = 2
}

// Major Texas Hold'em game states
export enum TexasHoldEmState {
	NotStarted = 0,
	Setup = 1,
	Drawing = 2,
	CommunityCardsAwaiting = 3,
	Betting = 4,
	Revealing = 5,
	SubmitBest = 6,
	ClaimPot = 7,
	StartNext = 8,
	Finished = 9
}

// Major betting round states
export enum BettingRoundState {
	Blinds = 0,
	PreFlop = 1,
	PostFlop = 2,
	PostTurn = 3,
	Showdown = 4
}

// Community cards dealing state
export enum CommunityCardsState {
	Opening = 0,
	FlopAwaiting = 1,
	TurnAwaiting = 2,
	RiverAwaiting = 3
}
