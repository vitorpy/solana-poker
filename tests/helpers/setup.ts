/**
 * Account setup helpers for Solana Poker tests
 *
 * Provides PDA derivation and account creation for all game accounts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createInitializeMintInstruction,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token';
import { getConnection, getProgramId, createFundedPayer } from './validator';
import {
  calculateKeccak256Hash,
  generateRandomArray,
  generateShuffleSeed,
  calculateSeedCommitment,
  deriveAllShuffleValues,
} from './crypto';

// PDA Seeds (matching src/constants.rs)
export const GAME_CONFIG_SEED = Buffer.from('game_config');
export const GAME_STATE_SEED = Buffer.from('game_state');
export const PLAYER_STATE_SEED = Buffer.from('player');
export const DECK_STATE_SEED = Buffer.from('deck');
export const ACCUMULATOR_SEED = Buffer.from('accumulator');
export const COMMUNITY_CARDS_SEED = Buffer.from('community');
export const VAULT_SEED = Buffer.from('vault');
export const PLAYER_LIST_SEED = Buffer.from('player_list');

// Account sizes (matching Rust state structs)
export const GAME_CONFIG_SIZE = 134; // bump(1) + game_id(32) + authority(32) + token_mint(32) + max_players(1) + current_players(1) + small_blind(8) + min_buy_in(8) + dealer_index(1) + is_accepting_players(1) + created_at(8) + timeout_seconds(4) + slash_percentage(1) + game_number(4) = 134
export const GAME_STATE_SIZE = 125;
export const PLAYER_STATE_SIZE = 256;
export const DECK_STATE_SIZE = 5025; // bump(1) + game_id(32) + work_deck(52*64) + card_owners(52*32) = 5025
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
  MapDeckPart2 = 26,
}

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
 * Player data structure
 */
export interface PlayerData {
  keypair: Keypair;
  tokenAccount: PublicKey;
  playerState: PublicKey;
  playerStateBump: number;
  /** 32-byte seed for shuffle derivation */
  shuffleSeed: Uint8Array;
  /** Derived shuffle values (for shuffle/lock/reveal operations) */
  shuffleVector: string[];
  /** commitment = keccak256(shuffleSeed) - stored on-chain */
  commitment: Uint8Array;
  lockVector: string[];
}

/**
 * Derive game config PDA
 */
export function deriveGameConfig(gameId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [GAME_CONFIG_SEED, gameId],
    programId
  );
}

/**
 * Derive game state PDA
 */
export function deriveGameState(gameId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [GAME_STATE_SEED, gameId],
    programId
  );
}

/**
 * Derive player state PDA
 */
export function derivePlayerState(
  gameId: Uint8Array,
  player: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PLAYER_STATE_SEED, gameId, player.toBuffer()],
    programId
  );
}

/**
 * Derive deck state PDA
 */
export function deriveDeckState(gameId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [DECK_STATE_SEED, gameId],
    programId
  );
}

/**
 * Derive accumulator PDA
 */
export function deriveAccumulator(gameId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [ACCUMULATOR_SEED, gameId],
    programId
  );
}

/**
 * Derive community cards PDA
 */
export function deriveCommunityCards(gameId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [COMMUNITY_CARDS_SEED, gameId],
    programId
  );
}

/**
 * Derive player list PDA
 */
export function derivePlayerList(gameId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PLAYER_LIST_SEED, gameId],
    programId
  );
}

/**
 * Derive vault PDA
 */
export function deriveVault(gameId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, gameId],
    programId
  );
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
export function deriveAllGameAccounts(gameId: Uint8Array, programId: PublicKey): GameAccounts {
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
    vaultBump,
  };
}

/**
 * Create an SPL token mint
 */
export async function createTokenMint(
  payer: Keypair,
  authority: PublicKey,
  decimals: number = TOKEN_DECIMALS
): Promise<Keypair> {
  const connection = getConnection();
  const mint = Keypair.generate();

  const lamports = await getMinimumBalanceForRentExemptMint(connection);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mint.publicKey,
      decimals,
      authority,
      null // freeze authority
    )
  );

  await sendAndConfirmTransaction(connection, tx, [payer, mint], {
    commitment: 'confirmed',
  });

  return mint;
}

/**
 * Create an associated token account for a player
 */
export async function createTokenAccount(
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const connection = getConnection();
  const ata = await getAssociatedTokenAddress(mint, owner);

  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      ata,
      owner,
      mint
    )
  );

  await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: 'confirmed',
  });

  return ata;
}

/**
 * Mint tokens to an account
 */
export async function mintTokens(
  payer: Keypair,
  mint: PublicKey,
  mintAuthority: Keypair,
  destination: PublicKey,
  amount: bigint
): Promise<void> {
  const connection = getConnection();

  const tx = new Transaction().add(
    createMintToInstruction(
      mint,
      destination,
      mintAuthority.publicKey,
      amount
    )
  );

  await sendAndConfirmTransaction(connection, tx, [payer, mintAuthority], {
    commitment: 'confirmed',
  });
}

/**
 * Get token amount with decimals
 */
export function getTokenAmount(amount: number, decimals: number = TOKEN_DECIMALS): bigint {
  return BigInt(amount) * BigInt(10 ** decimals);
}

/**
 * Create account for PDA (allocates space and assigns to program)
 */
export async function createPdaAccount(
  payer: Keypair,
  pdaAddress: PublicKey,
  space: number,
  programId: PublicKey
): Promise<void> {
  const connection = getConnection();
  const lamports = await connection.getMinimumBalanceForRentExemption(space);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: pdaAddress,
      space,
      lamports,
      programId,
    })
  );

  await sendAndConfirmTransaction(connection, tx, [payer], {
    commitment: 'confirmed',
  });
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
  const data = Buffer.alloc(50); // 1 (discriminator) + 32 (gameId) + 1 (maxPlayers) + 8 (smallBlind) + 8 (minBuyIn)
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
  const data = Buffer.alloc(41); // 1 (discriminator) + 32 (commitment) + 8 (depositAmount)
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
  authority: Keypair,
  tokenMint: PublicKey,
  maxPlayers: number = 2,
  smallBlind: bigint = getTokenAmount(10),
  minBuyIn: bigint = getTokenAmount(100)
): Promise<GameAccounts> {
  const connection = getConnection();
  const programId = getProgramId();
  const gameId = generateGameId();
  const accounts = deriveAllGameAccounts(gameId, programId);

  // Create all PDA accounts first (they need to exist before initialization)
  const createAccountsIxs: TransactionInstruction[] = [];

  // Calculate rent-exempt amounts
  const gameConfigLamports = await connection.getMinimumBalanceForRentExemption(GAME_CONFIG_SIZE);
  const gameStateLamports = await connection.getMinimumBalanceForRentExemption(GAME_STATE_SIZE);
  const deckStateLamports = await connection.getMinimumBalanceForRentExemption(DECK_STATE_SIZE);
  const accumulatorLamports = await connection.getMinimumBalanceForRentExemption(ACCUMULATOR_STATE_SIZE);
  const communityLamports = await connection.getMinimumBalanceForRentExemption(COMMUNITY_CARDS_SIZE);
  const playerListLamports = await connection.getMinimumBalanceForRentExemption(PLAYER_LIST_SIZE);

  // For PDAs, we need to use the allocate instruction with seeds
  // Actually, the program should create these accounts using CPI
  // For now, we'll just call the initialize instruction and let the program handle it

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
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: accounts.vault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId,
    data: initData,
  });

  const tx = new Transaction().add(initIx);

  await sendAndConfirmTransaction(connection, tx, [authority], {
    commitment: 'confirmed',
  });

  return accounts;
}

/**
 * Create a player with shuffle seed and commitment
 *
 * Uses seed-based derivation:
 * - shuffleSeed: random 32-byte seed
 * - commitment: keccak256(shuffleSeed) - stored on-chain during JoinGame
 * - shuffleVector: derived as v[i] = keccak256(seed || i) for shuffle/lock/reveal
 */
export async function createPlayer(
  payer: Keypair,
  gameAccounts: GameAccounts,
  tokenMint: PublicKey,
  buyIn: bigint
): Promise<PlayerData> {
  const connection = getConnection();
  const programId = getProgramId();

  // Create player keypair
  const player = await createFundedPayer(2 * LAMPORTS_PER_SOL);

  // Create token account
  const tokenAccount = await createTokenAccount(payer, tokenMint, player.publicKey);

  // Mint tokens for buy-in
  await mintTokens(payer, tokenMint, payer, tokenAccount, buyIn);

  // Generate shuffle seed and commitment using seed-based derivation
  // commitment = keccak256(seed) - preserves hiding property
  const shuffleSeed = generateShuffleSeed();
  const commitment = calculateSeedCommitment(shuffleSeed);

  // Derive shuffle values for client-side operations (shuffle/lock/reveal)
  // v[i] = keccak256(seed || i) - same derivation as on-chain
  const shuffleVector = deriveAllShuffleValues(shuffleSeed);

  // Generate lock vector for later
  const lockVector = generateRandomArray();

  // Derive player state PDA
  const [playerState, playerStateBump] = derivePlayerState(
    gameAccounts.gameId,
    player.publicKey,
    programId
  );

  return {
    keypair: player,
    tokenAccount,
    playerState,
    playerStateBump,
    shuffleSeed,
    shuffleVector,
    commitment,
    lockVector,
  };
}

/**
 * Join a player to a game
 */
export async function joinGame(
  playerData: PlayerData,
  gameAccounts: GameAccounts,
  depositAmount: bigint
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  const joinData = buildJoinGameData(playerData.commitment, depositAmount);

  const joinIx = new TransactionInstruction({
    keys: [
      { pubkey: playerData.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: playerData.playerState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: true },
      { pubkey: playerData.tokenAccount, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.vault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId,
    data: joinData,
  });

  const tx = new Transaction().add(joinIx);

  await sendAndConfirmTransaction(connection, tx, [playerData.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Set up a complete game with players ready to play
 */
export async function setupCompleteGame(
  playerCount: number = 2,
  smallBlind: bigint = getTokenAmount(10),
  minBuyIn: bigint = getTokenAmount(100),
  buyInAmount: bigint = getTokenAmount(1000)
): Promise<{
  authority: Keypair;
  tokenMint: Keypair;
  gameAccounts: GameAccounts;
  players: PlayerData[];
}> {
  // Create authority (also mint authority)
  const authority = await createFundedPayer(10 * LAMPORTS_PER_SOL);

  // Create token mint
  const tokenMint = await createTokenMint(authority, authority.publicKey);

  // Initialize game
  const gameAccounts = await initializeGame(
    authority,
    tokenMint.publicKey,
    playerCount,
    smallBlind,
    minBuyIn
  );

  // Create and join players
  const players: PlayerData[] = [];
  for (let i = 0; i < playerCount; i++) {
    const player = await createPlayer(authority, gameAccounts, tokenMint.publicKey, buyInAmount);
    await joinGame(player, gameAccounts, buyInAmount);
    players.push(player);
  }

  return {
    authority,
    tokenMint,
    gameAccounts,
    players,
  };
}

/**
 * Fetch and deserialize game config account
 */
export async function fetchGameConfig(gameConfig: PublicKey): Promise<{
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
}> {
  const connection = getConnection();
  const account = await connection.getAccountInfo(gameConfig);

  if (!account) {
    throw new Error('Game config account not found');
  }

  const data = account.data;
  let offset = 0;

  const bump = data[offset];
  offset += 1;

  const gameId = data.slice(offset, offset + 32);
  offset += 32;

  const authority = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const tokenMint = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  const maxPlayers = data[offset];
  offset += 1;

  const currentPlayers = data[offset];
  offset += 1;

  const smallBlind = data.readBigUInt64LE(offset);
  offset += 8;

  const minBuyIn = data.readBigUInt64LE(offset);
  offset += 8;

  const dealerIndex = data[offset];
  offset += 1;

  const isAcceptingPlayers = data[offset] !== 0;

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
  };
}

/**
 * Fetch and deserialize player state account
 */
export async function fetchPlayerState(playerState: PublicKey): Promise<{
  bump: number;
  gameId: Uint8Array;
  player: Uint8Array;
  seatIndex: number;
  chips: bigint;
  currentBet: bigint;
  commitment: Uint8Array;
  hasCommitted: boolean;
  holeCards: number[];
  holeCardsCount: number;
  isFolded: boolean;
}> {
  const connection = getConnection();
  const account = await connection.getAccountInfo(playerState);

  if (!account) {
    throw new Error('Player state account not found');
  }

  const data = account.data;
  let offset = 0;

  const bump = data[offset];
  offset += 1;

  const gameId = data.slice(offset, offset + 32);
  offset += 32;

  const player = data.slice(offset, offset + 32);
  offset += 32;

  const seatIndex = data[offset];
  offset += 1;

  const chips = data.readBigUInt64LE(offset);
  offset += 8;

  const currentBet = data.readBigUInt64LE(offset);
  offset += 8;

  const commitment = data.slice(offset, offset + 32);
  offset += 32;

  const hasCommitted = data[offset] !== 0;
  offset += 1;

  const holeCards = [data[offset], data[offset + 1]];
  offset += 2;

  const holeCardsCount = data[offset];
  offset += 1;

  // Skip revealed_cards (128 bytes) and revealed_cards_count (1)
  offset += 129;

  const isFolded = data[offset] !== 0;

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
    isFolded,
  };
}

/**
 * Fetch and deserialize game state account
 */
export async function fetchGameState(gameState: PublicKey): Promise<{
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
  pot: bigint;
  currentCallAmount: bigint;
  cardToReveal: number;
  cardsLeftInDeck: number;
}> {
  const connection = getConnection();
  const account = await connection.getAccountInfo(gameState);

  if (!account) {
    throw new Error('Game state account not found');
  }

  const data = account.data;
  let offset = 0;

  const bump = data[offset];
  offset += 1;

  const gameId = data.slice(offset, offset + 32);
  offset += 32;

  const gamePhase = data[offset];
  offset += 1;

  const shufflingState = data[offset];
  offset += 1;

  const drawingState = data[offset];
  offset += 1;

  const texasState = data[offset];
  offset += 1;

  const bettingRoundState = data[offset];
  offset += 1;

  const communityCardsState = data[offset];
  offset += 1;

  const currentTurn = data[offset];
  offset += 1;

  const activePlayerCount = data[offset];
  offset += 1;

  const numFoldedPlayers = data[offset];
  offset += 1;

  const cardsDrawn = data[offset];
  offset += 1;

  // Skip player_cards_opened and num_submitted_hands
  offset += 2;

  const pot = data.readBigUInt64LE(offset);
  offset += 8;

  const currentCallAmount = data.readBigUInt64LE(offset);
  offset += 8;

  // Skip last_to_call (32 bytes), is_everybody_all_in (1), pot_claimed (1)
  offset += 34;

  const cardToReveal = data[offset];
  offset += 1;

  const cardsLeftInDeck = data[offset];

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
    pot,
    currentCallAmount,
    cardToReveal,
    cardsLeftInDeck,
  };
}

// Game phase enums (matching Rust enums in src/state/enums.rs)
export enum GamePhase {
  WaitingForPlayers = 0,
  Shuffling = 1,
  Drawing = 2,
  Opening = 3,
  Finished = 4,
}

export enum ShufflingState {
  NotStarted = 0,
  Committing = 1,
  Generating = 2,
  Shuffling = 3,
  Locking = 4,
}

export enum DrawingState {
  NotDrawn = 0,
  Picking = 1,
  Revealing = 2,
}

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
  Finished = 9,
}

export enum BettingRoundState {
  Blinds = 0,
  PreFlop = 1,
  PostFlop = 2,
  PostTurn = 3,
  Showdown = 4,
}

export enum CommunityCardsState {
  Opening = 0,
  FlopAwaiting = 1,
  TurnAwaiting = 2,
  RiverAwaiting = 3,
}
