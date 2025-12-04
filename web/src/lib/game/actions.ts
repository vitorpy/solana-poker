/**
 * Game action transaction builders for Solana Poker
 * Adapted from tests/helpers/setup.ts for frontend use
 */

import {
	Connection,
	Keypair,
	PublicKey,
	SystemProgram,
	Transaction,
	TransactionInstruction,
	sendAndConfirmTransaction
} from '@solana/web3.js';
import {
	TOKEN_PROGRAM_ID,
	NATIVE_MINT,
	getAssociatedTokenAddress,
	createAssociatedTokenAccountInstruction,
	createSyncNativeInstruction
} from '@solana/spl-token';
import pkg from 'js-sha3';
const { keccak256 } = pkg;
import { PROGRAM_ID, Instruction, TOKEN_MINT } from './constants';
import { deriveAllGameAccounts, derivePlayerState, generateGameId, type GameAccounts } from './pda';

/**
 * Generate a random 32-byte shuffle seed
 */
export function generateShuffleSeed(): Uint8Array {
	const array = new Uint8Array(32);
	crypto.getRandomValues(array);
	return array;
}

/**
 * Calculate the commitment for a shuffle seed
 * commitment = keccak256(seed)
 */
export function calculateSeedCommitment(seed: Uint8Array): Uint8Array {
	const hash = keccak256(seed);
	return new Uint8Array(Buffer.from(hash, 'hex'));
}

/**
 * Build initialize game instruction data
 */
export function buildInitializeGameData(
	gameId: Uint8Array,
	maxPlayers: number,
	smallBlind: bigint,
	minBuyIn: bigint
): Buffer {
	const data = Buffer.alloc(50);
	let offset = 0;

	data.writeUInt8(Instruction.InitializeGame, offset);
	offset += 1;

	data.set(gameId, offset);
	offset += 32;

	data.writeUInt8(maxPlayers, offset);
	offset += 1;

	data.writeBigUInt64LE(smallBlind, offset);
	offset += 8;

	data.writeBigUInt64LE(minBuyIn, offset);

	return data;
}

/**
 * Build join game instruction data
 */
export function buildJoinGameData(commitment: Uint8Array, depositAmount: bigint): Buffer {
	const data = Buffer.alloc(41);
	let offset = 0;

	data.writeUInt8(Instruction.JoinGame, offset);
	offset += 1;

	data.set(commitment, offset);
	offset += 32;

	data.writeBigUInt64LE(depositAmount, offset);

	return data;
}

/**
 * Initialize a new game
 */
export async function initializeGame(
	connection: Connection,
	authority: Keypair,
	maxPlayers: number = 2,
	smallBlind: bigint = BigInt(10_000_000_000), // 10 SOL in lamports
	minBuyIn: bigint = BigInt(100_000_000_000) // 100 SOL in lamports
): Promise<GameAccounts> {
	console.log('[initializeGame] Starting...');
	console.log('[initializeGame] Authority:', authority.publicKey.toBase58());
	console.log('[initializeGame] Program ID:', PROGRAM_ID.toBase58());
	console.log('[initializeGame] RPC:', connection.rpcEndpoint);

	const gameId = generateGameId();
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);

	console.log('[initializeGame] GameConfig PDA:', accounts.gameConfig.toBase58());

	const initData = buildInitializeGameData(gameId, maxPlayers, smallBlind, minBuyIn);

	const initIx = new TransactionInstruction({
		keys: [
			{ pubkey: authority.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameConfig, isSigner: false, isWritable: true },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: accounts.deckState, isSigner: false, isWritable: true },
			{ pubkey: accounts.accumulator, isSigner: false, isWritable: true },
			{ pubkey: accounts.communityCards, isSigner: false, isWritable: true },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: true },
			{ pubkey: TOKEN_MINT, isSigner: false, isWritable: false },
			{ pubkey: accounts.vault, isSigner: false, isWritable: true },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
			{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
		],
		programId: PROGRAM_ID,
		data: initData
	});

	const tx = new Transaction().add(initIx);

	console.log('[initializeGame] Sending transaction...');
	const signature = await sendAndConfirmTransaction(connection, tx, [authority], {
		commitment: 'confirmed'
	});
	console.log('[initializeGame] Confirmed:', signature);

	return accounts;
}

/**
 * Wrap SOL into WSOL for buy-in
 * Returns the WSOL ATA address and the transaction to execute
 */
export async function createWrapSolTransaction(
	connection: Connection,
	payer: PublicKey,
	amount: bigint
): Promise<{ ata: PublicKey; transaction: Transaction }> {
	const ata = await getAssociatedTokenAddress(NATIVE_MINT, payer);

	// Check if ATA already exists
	const ataInfo = await connection.getAccountInfo(ata);

	const tx = new Transaction();

	// Create ATA if it doesn't exist
	if (!ataInfo) {
		tx.add(createAssociatedTokenAccountInstruction(payer, ata, payer, NATIVE_MINT));
	}

	// Transfer SOL to ATA
	tx.add(
		SystemProgram.transfer({
			fromPubkey: payer,
			toPubkey: ata,
			lamports: amount
		})
	);

	// Sync native (updates token balance to reflect SOL transfer)
	tx.add(createSyncNativeInstruction(ata));

	return { ata, transaction: tx };
}

/**
 * Join a game with WSOL
 */
export async function joinGame(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array,
	depositAmount: bigint
): Promise<{ signature: string; shuffleSeed: Uint8Array; playerState: PublicKey }> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const [playerState] = derivePlayerState(gameId, player.publicKey, PROGRAM_ID);

	// Generate shuffle seed and commitment
	const shuffleSeed = generateShuffleSeed();
	const commitment = calculateSeedCommitment(shuffleSeed);

	// Get or create WSOL ATA
	const { ata: playerTokenAccount, transaction: wrapTx } = await createWrapSolTransaction(
		connection,
		player.publicKey,
		depositAmount
	);

	// Build join game instruction
	const joinData = buildJoinGameData(commitment, depositAmount);

	const joinIx = new TransactionInstruction({
		keys: [
			{ pubkey: player.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameConfig, isSigner: false, isWritable: true },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: playerState, isSigner: false, isWritable: true },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: true },
			{ pubkey: playerTokenAccount, isSigner: false, isWritable: true },
			{ pubkey: accounts.vault, isSigner: false, isWritable: true },
			{ pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
			{ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }
		],
		programId: PROGRAM_ID,
		data: joinData
	});

	// Combine wrap SOL + join game in single transaction
	wrapTx.add(joinIx);

	const signature = await sendAndConfirmTransaction(connection, wrapTx, [player], {
		commitment: 'confirmed'
	});

	return { signature, shuffleSeed, playerState };
}

/**
 * Fetch and deserialize game config
 */
export async function fetchGameConfig(
	connection: Connection,
	gameId: Uint8Array
): Promise<GameConfigData | null> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const accountInfo = await connection.getAccountInfo(accounts.gameConfig);

	if (!accountInfo) return null;

	return deserializeGameConfig(accountInfo.data);
}

/**
 * Fetch and deserialize game state
 */
export async function fetchGameState(
	connection: Connection,
	gameId: Uint8Array
): Promise<GameStateData | null> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const accountInfo = await connection.getAccountInfo(accounts.gameState);

	if (!accountInfo) return null;

	return deserializeGameState(accountInfo.data);
}

/**
 * Fetch and deserialize player state
 */
export async function fetchPlayerState(
	connection: Connection,
	gameId: Uint8Array,
	player: PublicKey
): Promise<PlayerStateData | null> {
	const [playerState] = derivePlayerState(gameId, player, PROGRAM_ID);
	const accountInfo = await connection.getAccountInfo(playerState);

	if (!accountInfo) return null;

	return deserializePlayerState(accountInfo.data);
}

// Data types for deserialized state

export interface GameConfigData {
	bump: number;
	gameId: Uint8Array;
	authority: PublicKey;
	tokenMint: PublicKey;
	maxPlayers: number;
	currentPlayers: number;
	smallBlind: bigint;
	minBuyIn: bigint;
	dealerIndex: number;
	isAcceptingPlayers: boolean;
	createdAt: bigint;
	timeoutSeconds: number;
	slashPercentage: number;
	gameNumber: number;
}

export interface GameStateData {
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
	potSize: bigint;
	currentCallAmount: bigint;
	currentBet: bigint;
	lastRaise: bigint;
	lastToCall: PublicKey;
	isEverybodyAllIn: boolean;
	potClaimed: boolean;
	cardToReveal: number;
	cardsLeftInDeck: number;
	isDeckSubmitted: boolean;
	lastActionTimestamp: bigint;
}

export interface PlayerStateData {
	bump: number;
	gameId: Uint8Array;
	player: PublicKey;
	seatIndex: number;
	chips: bigint;
	currentBet: bigint;
	commitment: Uint8Array;
	hasCommitted: boolean;
	holeCards: number[];
	holeCardsCount: number;
	isFolded: boolean;
}

// Deserialize functions

function deserializeGameConfig(data: Buffer): GameConfigData {
	let offset = 0;

	const bump = data.readUInt8(offset);
	offset += 1;

	const gameId = new Uint8Array(data.subarray(offset, offset + 32));
	offset += 32;

	const authority = new PublicKey(data.subarray(offset, offset + 32));
	offset += 32;

	const tokenMint = new PublicKey(data.subarray(offset, offset + 32));
	offset += 32;

	const maxPlayers = data.readUInt8(offset);
	offset += 1;

	const currentPlayers = data.readUInt8(offset);
	offset += 1;

	const smallBlind = data.readBigUInt64LE(offset);
	offset += 8;

	const minBuyIn = data.readBigUInt64LE(offset);
	offset += 8;

	const dealerIndex = data.readUInt8(offset);
	offset += 1;

	const isAcceptingPlayers = data.readUInt8(offset) !== 0;
	offset += 1;

	const createdAt = data.readBigInt64LE(offset);
	offset += 8;

	const timeoutSeconds = data.readUInt32LE(offset);
	offset += 4;

	const slashPercentage = data.readUInt8(offset);
	offset += 1;

	const gameNumber = data.readUInt32LE(offset);

	return {
		bump,
		gameId,
		authority,
		tokenMint,
		maxPlayers,
		currentPlayers,
		smallBlind,
		minBuyIn,
		dealerIndex,
		isAcceptingPlayers,
		createdAt,
		timeoutSeconds,
		slashPercentage,
		gameNumber
	};
}

function deserializeGameState(data: Buffer): GameStateData {
	let offset = 0;

	const bump = data.readUInt8(offset);
	offset += 1;

	const gameId = new Uint8Array(data.subarray(offset, offset + 32));
	offset += 32;

	const gamePhase = data.readUInt8(offset);
	offset += 1;

	const shufflingState = data.readUInt8(offset);
	offset += 1;

	const drawingState = data.readUInt8(offset);
	offset += 1;

	const texasState = data.readUInt8(offset);
	offset += 1;

	const bettingRoundState = data.readUInt8(offset);
	offset += 1;

	const communityCardsState = data.readUInt8(offset);
	offset += 1;

	const currentTurn = data.readUInt8(offset);
	offset += 1;

	const activePlayerCount = data.readUInt8(offset);
	offset += 1;

	const numFoldedPlayers = data.readUInt8(offset);
	offset += 1;

	const cardsDrawn = data.readUInt8(offset);
	offset += 1;

	const playerCardsOpened = data.readUInt8(offset);
	offset += 1;

	const numSubmittedHands = data.readUInt8(offset);
	offset += 1;

	const pot = data.readBigUInt64LE(offset);
	offset += 8;

	// Note: pot_size, current_bet, last_raise are NOT serialized on-chain
	// They are derived/aliased values in the Rust from_bytes implementation
	const currentCallAmount = data.readBigUInt64LE(offset);
	offset += 8;

	const lastToCall = new PublicKey(data.subarray(offset, offset + 32));
	offset += 32;

	// Compute aliased values (matching Rust from_bytes behavior)
	const potSize = pot;
	const currentBet = currentCallAmount;
	const lastRaise = BigInt(0);

	const isEverybodyAllIn = data.readUInt8(offset) !== 0;
	offset += 1;

	const potClaimed = data.readUInt8(offset) !== 0;
	offset += 1;

	const cardToReveal = data.readUInt8(offset);
	offset += 1;

	const cardsLeftInDeck = data.readUInt8(offset);
	offset += 1;

	const isDeckSubmitted = data.readUInt8(offset) !== 0;
	offset += 1;

	const lastActionTimestamp = data.readBigInt64LE(offset);

	return {
		bump,
		gameId,
		gamePhase,
		shufflingState,
		drawingState,
		texasState,
		bettingRoundState,
		communityCardsState,
		currentTurn,
		activePlayerCount,
		numFoldedPlayers,
		cardsDrawn,
		playerCardsOpened,
		numSubmittedHands,
		pot,
		potSize,
		currentCallAmount,
		currentBet,
		lastRaise,
		lastToCall,
		isEverybodyAllIn,
		potClaimed,
		cardToReveal,
		cardsLeftInDeck,
		isDeckSubmitted,
		lastActionTimestamp
	};
}

function deserializePlayerState(data: Buffer): PlayerStateData {
	let offset = 0;

	const bump = data.readUInt8(offset);
	offset += 1;

	const gameId = new Uint8Array(data.subarray(offset, offset + 32));
	offset += 32;

	const player = new PublicKey(data.subarray(offset, offset + 32));
	offset += 32;

	const seatIndex = data.readUInt8(offset);
	offset += 1;

	const chips = data.readBigUInt64LE(offset);
	offset += 8;

	const currentBet = data.readBigUInt64LE(offset);
	offset += 8;

	const commitment = new Uint8Array(data.subarray(offset, offset + 32));
	offset += 32;

	const hasCommitted = data.readUInt8(offset) !== 0;
	offset += 1;

	const holeCards = [data.readUInt8(offset), data.readUInt8(offset + 1)];
	offset += 2;

	const holeCardsCount = data.readUInt8(offset);
	offset += 1;

	// Skip revealed cards (complex structure)
	offset += 2 * 64; // 2 points × 64 bytes each

	const revealedCardsCount = data.readUInt8(offset);
	offset += 1;

	const isFolded = data.readUInt8(offset) !== 0;

	return {
		bump,
		gameId,
		player,
		seatIndex,
		chips,
		currentBet,
		commitment,
		hasCommitted,
		holeCards,
		holeCardsCount,
		isFolded
	};
}

// ============== Betting Actions ==============

/**
 * Build bet instruction data
 */
export function buildBetData(amount: bigint): Buffer {
	const data = Buffer.alloc(9);
	data.writeUInt8(Instruction.Bet, 0);
	data.writeBigUInt64LE(amount, 1);
	return data;
}

/**
 * Build fold instruction data
 */
export function buildFoldData(): Buffer {
	const data = Buffer.alloc(1);
	data.writeUInt8(Instruction.Fold, 0);
	return data;
}

/**
 * Place a bet (call or raise)
 * Accounts: player, game_config, game_state, player_state, player_list
 */
export async function betAction(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array,
	amount: bigint
): Promise<string> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const [playerState] = derivePlayerState(gameId, player.publicKey, PROGRAM_ID);

	const betData = buildBetData(amount);

	const betIx = new TransactionInstruction({
		keys: [
			{ pubkey: player.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: playerState, isSigner: false, isWritable: true },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: false }
		],
		programId: PROGRAM_ID,
		data: betData
	});

	const tx = new Transaction().add(betIx);

	const signature = await sendAndConfirmTransaction(connection, tx, [player], {
		commitment: 'confirmed'
	});

	return signature;
}

/**
 * Fold the current hand
 * Accounts: player, game_config, game_state, player_state, player_list
 */
export async function foldAction(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array
): Promise<string> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const [playerState] = derivePlayerState(gameId, player.publicKey, PROGRAM_ID);

	const foldData = buildFoldData();

	const foldIx = new TransactionInstruction({
		keys: [
			{ pubkey: player.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: playerState, isSigner: false, isWritable: true },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: false }
		],
		programId: PROGRAM_ID,
		data: foldData
	});

	const tx = new Transaction().add(foldIx);

	const signature = await sendAndConfirmTransaction(connection, tx, [player], {
		commitment: 'confirmed'
	});

	return signature;
}

/**
 * Fetch player list to determine current turn
 */
export async function fetchPlayerList(
	connection: Connection,
	gameId: Uint8Array
): Promise<PublicKey[] | null> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const accountInfo = await connection.getAccountInfo(accounts.playerList);

	if (!accountInfo) return null;

	return deserializePlayerList(accountInfo.data);
}

function deserializePlayerList(data: Buffer): PublicKey[] {
	let offset = 0;

	// Skip bump
	offset += 1;

	// Skip game_id
	offset += 32;

	const playerCount = data.readUInt8(offset);
	offset += 1;

	const players: PublicKey[] = [];
	for (let i = 0; i < playerCount; i++) {
		const player = new PublicKey(data.subarray(offset, offset + 32));
		offset += 32;
		players.push(player);
	}

	return players;
}

// ============== Protocol Actions ==============

import {
	Bn254Point,
	compressPoint,
	keyToBytes,
	modInverse,
	generateWorkDeck,
	encryptWorkDeck,
	shuffleArray,
	lockWorkDeck
} from './crypto';

// Constants for split transactions
const CARDS_PER_PART = 26;
const COMPRESSED_POINT_SIZE = 32; // arkworks compressed format

/**
 * Build instruction with discriminator + data
 */
function buildInstructionData(discriminator: Instruction, data?: Buffer): Buffer {
	if (data) {
		const result = Buffer.alloc(1 + data.length);
		result.writeUInt8(discriminator, 0);
		data.copy(result, 1);
		return result;
	} else {
		return Buffer.from([discriminator]);
	}
}

/**
 * Generate shuffle vector instruction
 * Data: 32-byte seed
 * Submits the player's shuffle seed to reveal commitment and build accumulator
 */
export async function generateAction(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array,
	shuffleSeed: Uint8Array
): Promise<string> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const [playerState] = derivePlayerState(gameId, player.publicKey, PROGRAM_ID);

	const data = Buffer.from(shuffleSeed);

	const ix = new TransactionInstruction({
		keys: [
			{ pubkey: player.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: playerState, isSigner: false, isWritable: true },
			{ pubkey: accounts.accumulator, isSigner: false, isWritable: true },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: false }
		],
		programId: PROGRAM_ID,
		data: buildInstructionData(Instruction.Generate, data)
	});

	const tx = new Transaction().add(ix);
	const signature = await sendAndConfirmTransaction(connection, tx, [player], {
		commitment: 'confirmed'
	});

	return signature;
}

/**
 * Map deck Part 1 - submit first 26 cards from work deck
 */
export async function mapDeckPart1Action(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array,
	workDeck: Bn254Point[]
): Promise<string> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const [playerState] = derivePlayerState(gameId, player.publicKey, PROGRAM_ID);

	// Build data: 26 compressed EC points (32 bytes each)
	const data = Buffer.alloc(CARDS_PER_PART * COMPRESSED_POINT_SIZE);
	for (let i = 0; i < CARDS_PER_PART; i++) {
		const pointBytes = compressPoint(workDeck[i]);
		Buffer.from(pointBytes).copy(data, i * COMPRESSED_POINT_SIZE);
	}

	const ix = new TransactionInstruction({
		keys: [
			{ pubkey: player.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: accounts.accumulator, isSigner: false, isWritable: true },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: false },
			{ pubkey: playerState, isSigner: false, isWritable: true }
		],
		programId: PROGRAM_ID,
		data: buildInstructionData(Instruction.MapDeckPart1, data)
	});

	const tx = new Transaction().add(ix);
	const signature = await sendAndConfirmTransaction(connection, tx, [player], {
		commitment: 'confirmed'
	});

	return signature;
}

/**
 * Map deck Part 2 - submit remaining 26 cards from work deck
 */
export async function mapDeckPart2Action(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array,
	workDeck: Bn254Point[]
): Promise<string> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const [playerState] = derivePlayerState(gameId, player.publicKey, PROGRAM_ID);

	// Build data: 26 compressed EC points (32 bytes each)
	const remainingCards = 52 - CARDS_PER_PART;
	const data = Buffer.alloc(remainingCards * COMPRESSED_POINT_SIZE);
	for (let i = 0; i < remainingCards; i++) {
		const cardIndex = CARDS_PER_PART + i;
		const pointBytes = compressPoint(workDeck[cardIndex]);
		Buffer.from(pointBytes).copy(data, i * COMPRESSED_POINT_SIZE);
	}

	const ix = new TransactionInstruction({
		keys: [
			{ pubkey: player.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: accounts.accumulator, isSigner: false, isWritable: true },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: false },
			{ pubkey: playerState, isSigner: false, isWritable: true }
		],
		programId: PROGRAM_ID,
		data: buildInstructionData(Instruction.MapDeckPart2, data)
	});

	const tx = new Transaction().add(ix);
	const signature = await sendAndConfirmTransaction(connection, tx, [player], {
		commitment: 'confirmed'
	});

	return signature;
}

/**
 * Map deck - calls Part1 and Part2
 */
export async function mapDeckAction(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array,
	workDeck: Bn254Point[]
): Promise<void> {
	await mapDeckPart1Action(connection, player, gameId, workDeck);
	await mapDeckPart2Action(connection, player, gameId, workDeck);
}

/**
 * Shuffle Part 1 - submit first 26 cards of shuffled/encrypted deck
 */
export async function shufflePart1Action(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array,
	shuffledDeck: Bn254Point[]
): Promise<string> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const [playerState] = derivePlayerState(gameId, player.publicKey, PROGRAM_ID);

	/// Build data: 26 compressed points (32 bytes each)
	const data = Buffer.alloc(CARDS_PER_PART * COMPRESSED_POINT_SIZE);
	for (let i = 0; i < CARDS_PER_PART; i++) {
		const pointBytes = compressPoint(shuffledDeck[i]);
		Buffer.from(pointBytes).copy(data, i * COMPRESSED_POINT_SIZE);
	}

	const ix = new TransactionInstruction({
		keys: [
			{ pubkey: player.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: accounts.deckState, isSigner: false, isWritable: true },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: false },
			{ pubkey: playerState, isSigner: false, isWritable: true }
		],
		programId: PROGRAM_ID,
		data: buildInstructionData(Instruction.ShufflePart1, data)
	});

	const tx = new Transaction().add(ix);
	const signature = await sendAndConfirmTransaction(connection, tx, [player], {
		commitment: 'confirmed'
	});

	return signature;
}

/**
 * Shuffle Part 2 - submit remaining 26 cards of shuffled/encrypted deck
 */
export async function shufflePart2Action(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array,
	shuffledDeck: Bn254Point[]
): Promise<string> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const [playerState] = derivePlayerState(gameId, player.publicKey, PROGRAM_ID);

	/// Build data: 26 compressed points (32 bytes each)
	const remainingCards = 52 - CARDS_PER_PART;
	const data = Buffer.alloc(remainingCards * COMPRESSED_POINT_SIZE);
	for (let i = 0; i < remainingCards; i++) {
		const cardIndex = CARDS_PER_PART + i;
		const pointBytes = compressPoint(shuffledDeck[cardIndex]);
		Buffer.from(pointBytes).copy(data, i * COMPRESSED_POINT_SIZE);
	}

	const ix = new TransactionInstruction({
		keys: [
			{ pubkey: player.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: accounts.deckState, isSigner: false, isWritable: true },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: false },
			{ pubkey: playerState, isSigner: false, isWritable: true }
		],
		programId: PROGRAM_ID,
		data: buildInstructionData(Instruction.ShufflePart2, data)
	});

	const tx = new Transaction().add(ix);
	const signature = await sendAndConfirmTransaction(connection, tx, [player], {
		commitment: 'confirmed'
	});

	return signature;
}

/**
 * Shuffle deck - encrypt, shuffle, and submit via Part1 + Part2
 */
export async function shuffleAction(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array,
	currentDeck: Bn254Point[],
	playerKey: string
): Promise<Bn254Point[]> {
	// Encrypt and shuffle
	const encrypted = encryptWorkDeck(currentDeck, playerKey);
	const shuffled = shuffleArray(encrypted);

	// Submit in two parts
	await shufflePart1Action(connection, player, gameId, shuffled);
	await shufflePart2Action(connection, player, gameId, shuffled);

	return shuffled;
}

/**
 * Lock Part 1 - submit first 26 locked cards
 */
export async function lockPart1Action(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array,
	lockedDeck: Bn254Point[]
): Promise<string> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const [playerState] = derivePlayerState(gameId, player.publicKey, PROGRAM_ID);

	/// Build data: 26 compressed points (32 bytes each)
	const data = Buffer.alloc(CARDS_PER_PART * COMPRESSED_POINT_SIZE);
	for (let i = 0; i < CARDS_PER_PART; i++) {
		const pointBytes = compressPoint(lockedDeck[i]);
		Buffer.from(pointBytes).copy(data, i * COMPRESSED_POINT_SIZE);
	}

	const ix = new TransactionInstruction({
		keys: [
			{ pubkey: player.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: accounts.deckState, isSigner: false, isWritable: true },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: false },
			{ pubkey: playerState, isSigner: false, isWritable: true }
		],
		programId: PROGRAM_ID,
		data: buildInstructionData(Instruction.LockPart1, data)
	});

	const tx = new Transaction().add(ix);
	const signature = await sendAndConfirmTransaction(connection, tx, [player], {
		commitment: 'confirmed'
	});

	return signature;
}

/**
 * Lock Part 2 - submit remaining 26 locked cards
 */
export async function lockPart2Action(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array,
	lockedDeck: Bn254Point[]
): Promise<string> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const [playerState] = derivePlayerState(gameId, player.publicKey, PROGRAM_ID);

	/// Build data: 26 compressed points (32 bytes each)
	const remainingCards = 52 - CARDS_PER_PART;
	const data = Buffer.alloc(remainingCards * COMPRESSED_POINT_SIZE);
	for (let i = 0; i < remainingCards; i++) {
		const cardIndex = CARDS_PER_PART + i;
		const pointBytes = compressPoint(lockedDeck[cardIndex]);
		Buffer.from(pointBytes).copy(data, i * COMPRESSED_POINT_SIZE);
	}

	const ix = new TransactionInstruction({
		keys: [
			{ pubkey: player.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: accounts.deckState, isSigner: false, isWritable: true },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: false },
			{ pubkey: playerState, isSigner: false, isWritable: true }
		],
		programId: PROGRAM_ID,
		data: buildInstructionData(Instruction.LockPart2, data)
	});

	const tx = new Transaction().add(ix);
	const signature = await sendAndConfirmTransaction(connection, tx, [player], {
		commitment: 'confirmed'
	});

	return signature;
}

/**
 * Lock cards - apply lock vector and submit via Part1 + Part2
 */
export async function lockAction(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array,
	currentDeck: Bn254Point[],
	lockVector: string[]
): Promise<Bn254Point[]> {
	// Apply lock vector
	const locked = lockWorkDeck(currentDeck, lockVector);

	// Submit in two parts
	await lockPart1Action(connection, player, gameId, locked);
	await lockPart2Action(connection, player, gameId, locked);

	return locked;
}

/**
 * Draw card instruction
 */
export async function drawAction(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array
): Promise<string> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const [playerState] = derivePlayerState(gameId, player.publicKey, PROGRAM_ID);

	const ix = new TransactionInstruction({
		keys: [
			{ pubkey: player.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: playerState, isSigner: false, isWritable: true },
			{ pubkey: accounts.deckState, isSigner: false, isWritable: true },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: true }
		],
		programId: PROGRAM_ID,
		data: buildInstructionData(Instruction.Draw)
	});

	const tx = new Transaction().add(ix);
	const signature = await sendAndConfirmTransaction(connection, tx, [player], {
		commitment: 'confirmed'
	});

	return signature;
}

/**
 * Reveal card instruction (other players decrypt a drawn card)
 * Data: inv_key(32) + index(1) = 33 bytes
 */
export async function revealAction(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array,
	cardIndex: number,
	lockKey: string
): Promise<string> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);

	// Compute modular inverse off-chain
	const invKey = modInverse(lockKey);
	const invKeyBytes = keyToBytes(invKey);

	const data = Buffer.alloc(33);
	Buffer.from(invKeyBytes).copy(data, 0);
	data.writeUInt8(cardIndex, 32);

	const ix = new TransactionInstruction({
		keys: [
			{ pubkey: player.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: accounts.deckState, isSigner: false, isWritable: true },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: true }
		],
		programId: PROGRAM_ID,
		data: buildInstructionData(Instruction.RevealCard, data)
	});

	const tx = new Transaction().add(ix);
	const signature = await sendAndConfirmTransaction(connection, tx, [player], {
		commitment: 'confirmed'
	});

	return signature;
}

/**
 * Place blind instruction
 * Data: amount(8 bytes)
 */
export async function placeBlindAction(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array,
	amount: bigint
): Promise<string> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const [playerState] = derivePlayerState(gameId, player.publicKey, PROGRAM_ID);

	const data = Buffer.alloc(8);
	data.writeBigUInt64LE(amount, 0);

	const ix = new TransactionInstruction({
		keys: [
			{ pubkey: player.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: playerState, isSigner: false, isWritable: true },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: false }
		],
		programId: PROGRAM_ID,
		data: buildInstructionData(Instruction.PlaceBlind, data)
	});

	const tx = new Transaction().add(ix);
	const signature = await sendAndConfirmTransaction(connection, tx, [player], {
		commitment: 'confirmed'
	});

	return signature;
}

/**
 * Open card instruction (for showdown)
 * Data: inv_key(32) + index(1) = 33 bytes
 */
export async function openAction(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array,
	cardIndex: number,
	lockKey: string
): Promise<string> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const [playerState] = derivePlayerState(gameId, player.publicKey, PROGRAM_ID);

	// Compute modular inverse off-chain
	const invKey = modInverse(lockKey);
	const invKeyBytes = keyToBytes(invKey);

	const data = Buffer.alloc(33);
	Buffer.from(invKeyBytes).copy(data, 0);
	data.writeUInt8(cardIndex, 32);

	const ix = new TransactionInstruction({
		keys: [
			{ pubkey: player.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: playerState, isSigner: false, isWritable: true },
			{ pubkey: accounts.deckState, isSigner: false, isWritable: true },
			{ pubkey: accounts.communityCards, isSigner: false, isWritable: false },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: false }
		],
		programId: PROGRAM_ID,
		data: buildInstructionData(Instruction.OpenCard, data)
	});

	const tx = new Transaction().add(ix);
	const signature = await sendAndConfirmTransaction(connection, tx, [player], {
		commitment: 'confirmed'
	});

	return signature;
}

/**
 * Deal community cards instruction
 */
export async function dealCommunityAction(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array
): Promise<string> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);

	const ix = new TransactionInstruction({
		keys: [
			{ pubkey: player.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: accounts.deckState, isSigner: false, isWritable: true },
			{ pubkey: accounts.communityCards, isSigner: false, isWritable: true },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: true }
		],
		programId: PROGRAM_ID,
		data: buildInstructionData(Instruction.DealCommunityCard)
	});

	const tx = new Transaction().add(ix);
	const signature = await sendAndConfirmTransaction(connection, tx, [player], {
		commitment: 'confirmed'
	});

	return signature;
}

/**
 * Open community card instruction
 * Data: inv_key(32) + index(1) = 33 bytes
 */
export async function openCommunityCardAction(
	connection: Connection,
	player: Keypair,
	gameId: Uint8Array,
	cardIndex: number,
	lockKey: string
): Promise<string> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);

	// Compute modular inverse off-chain
	const invKey = modInverse(lockKey);
	const invKeyBytes = keyToBytes(invKey);

	const data = Buffer.alloc(33);
	Buffer.from(invKeyBytes).copy(data, 0);
	data.writeUInt8(cardIndex, 32);

	const ix = new TransactionInstruction({
		keys: [
			{ pubkey: player.publicKey, isSigner: true, isWritable: true },
			{ pubkey: accounts.gameConfig, isSigner: false, isWritable: false },
			{ pubkey: accounts.gameState, isSigner: false, isWritable: true },
			{ pubkey: accounts.deckState, isSigner: false, isWritable: true },
			{ pubkey: accounts.communityCards, isSigner: false, isWritable: true },
			{ pubkey: accounts.playerList, isSigner: false, isWritable: false }
		],
		programId: PROGRAM_ID,
		data: buildInstructionData(Instruction.OpenCommunityCard, data)
	});

	const tx = new Transaction().add(ix);
	const signature = await sendAndConfirmTransaction(connection, tx, [player], {
		commitment: 'confirmed'
	});

	return signature;
}

/**
 * Fetch accumulator data from chain
 */
export async function fetchAccumulator(
	connection: Connection,
	gameId: Uint8Array
): Promise<string[] | null> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const accountInfo = await connection.getAccountInfo(accounts.accumulator);

	if (!accountInfo) return null;

	return deserializeAccumulator(accountInfo.data);
}

function deserializeAccumulator(data: Buffer): string[] {
	let offset = 0;

	// Skip bump
	offset += 1;

	// Skip game_id
	offset += 32;

	// Read 52 accumulator values (each 32 bytes)
	const values: string[] = [];
	for (let i = 0; i < 52; i++) {
		const value = data.subarray(offset, offset + 32);
		values.push('0x' + Buffer.from(value).toString('hex'));
		offset += 32;
	}

	return values;
}

/**
 * Fetch deck state from chain
 */
export interface DeckStateData {
	bump: number;
	gameId: Uint8Array;
	cards: { qx: string; qy: string }[];
	cardsCount: number;
}

export async function fetchDeckState(
	connection: Connection,
	gameId: Uint8Array
): Promise<DeckStateData | null> {
	const accounts = deriveAllGameAccounts(gameId, PROGRAM_ID);
	const accountInfo = await connection.getAccountInfo(accounts.deckState);

	if (!accountInfo) return null;

	return deserializeDeckState(accountInfo.data);
}

function deserializeDeckState(data: Buffer): DeckStateData {
	let offset = 0;

	const bump = data.readUInt8(offset);
	offset += 1;

	const gameId = new Uint8Array(data.subarray(offset, offset + 32));
	offset += 32;

	// Read 52 EC points (each 64 bytes: 32 for x, 32 for y)
	const cards: { qx: string; qy: string }[] = [];
	for (let i = 0; i < 52; i++) {
		const xBytes = data.subarray(offset, offset + 32);
		offset += 32;
		const yBytes = data.subarray(offset, offset + 32);
		offset += 32;

		cards.push({
			qx: BigInt('0x' + Buffer.from(xBytes).toString('hex')).toString(10),
			qy: BigInt('0x' + Buffer.from(yBytes).toString('hex')).toString(10)
		});
	}

	// Skip to cards_count (after 52 * 64 = 3328 bytes of points + 33 bytes header)
	// Actually the count may be stored elsewhere, let's just use 52 for now
	const cardsCount = 52;

	return {
		bump,
		gameId,
		cards,
		cardsCount
	};
}
