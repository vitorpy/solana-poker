/**
 * Game action wrappers for Solana Poker tests
 *
 * Provides high-level wrappers for all game instructions
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getConnection, getProgramId } from './validator';
import {
  GameAccounts,
  PlayerData,
  Instruction,
  derivePlayerState,
  DECK_SIZE,
  fetchGameState,
  fetchPlayerState,
} from './setup';
import {
  pointToBytes,
  compressPoint,
  transformPointArrayToTupleArray,
  encryptWorkDeck,
  shuffleWorkDeck,
  lockWorkDeck,
  generateWorkDeck,
  getCurveOrderBytes,
  keyToBytes,
  PointTuple,
  transformTupleArrayToPointArray,
  modInverse,
} from './crypto';

// Constants for split transactions
const CARDS_PER_PART = 26;
const COMPRESSED_POINT_SIZE = 32;

/**
 * Build instruction with discriminator + data
 */
function buildInstruction(discriminator: Instruction, data?: Buffer): Buffer {
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
 * Data: 32-byte seed (reduced from 1664 bytes via seed-based derivation)
 *
 * The on-chain program will:
 * 1. Verify keccak256(seed) == player's stored commitment
 * 2. Derive v[i] = keccak256(seed || i) for all 52 cards
 * 3. Add derived values to the accumulator
 */
export async function generateShuffleVector(
  player: PlayerData,
  gameAccounts: GameAccounts
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  // Build data: 32-byte seed (player.shuffleSeed must be set)
  if (!player.shuffleSeed) {
    throw new Error('Player shuffleSeed not set - ensure createPlayer uses seed-based approach');
  }

  const data = Buffer.from(player.shuffleSeed);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: player.playerState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.accumulator, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
    ],
    programId,
    data: buildInstruction(Instruction.Generate, data),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Map deck instruction - submit initial deck mapping
 * Data: 52 EC points (52 x 64 bytes = 3328 bytes)
 */
export async function mapDeck(
  player: PlayerData,
  gameAccounts: GameAccounts,
  accumulator: string[]
): Promise<any[]> {
  const connection = getConnection();
  const programId = getProgramId();

  // Generate work deck from accumulator
  const workDeck = generateWorkDeck(accumulator);

  // Build data: 52 x 64 bytes (EC points)
  const data = Buffer.alloc(DECK_SIZE * 64);
  for (let i = 0; i < DECK_SIZE; i++) {
    const point = workDeck[i];
    const pointBytes = pointToBytes(point);
    Buffer.from(pointBytes).copy(data, i * 64);
  }

  // Note: MapDeck might not have a discriminator in the instruction enum,
  // but assuming it does based on processor.rs pattern
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.accumulator, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
    ],
    programId,
    // MapDeck is instruction 2 (GenerateShuffleVector is 2, so MapDeck might be a different number)
    // Looking at processor.rs, the order seems to be: InitializeGame=0, JoinGame=1, GenerateShuffleVector=2, ShuffleDeck=3
    // But there's no MapDeck listed - it might be done differently
    // For now, let's include the data directly in shuffle
    data: buildInstruction(Instruction.ShuffleDeck, data), // This needs verification
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });

  return workDeck;
}

/**
 * Map deck part 1 instruction - stores cards 0-25 in accumulator
 */
export async function mapDeckPart1(
  player: PlayerData,
  gameAccounts: GameAccounts,
  workDeck: any[]
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  // Build data: 26 compressed EC points (26 x 33 bytes = 858 bytes)
  const data = Buffer.alloc(CARDS_PER_PART * COMPRESSED_POINT_SIZE);
  for (let i = 0; i < CARDS_PER_PART; i++) {
    const point = workDeck[i];
    const compressed = compressPoint(point);
    Buffer.from(compressed).copy(data, i * COMPRESSED_POINT_SIZE);
  }

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.accumulator, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
      { pubkey: player.playerState, isSigner: false, isWritable: true },
    ],
    programId,
    data: buildInstruction(Instruction.MapDeckPart1, data),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Map deck part 2 instruction - stores cards 26-51 in accumulator
 */
export async function mapDeckPart2(
  player: PlayerData,
  gameAccounts: GameAccounts,
  workDeck: any[]
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  // Build data: 26 compressed EC points (26 x 33 bytes = 858 bytes)
  const remainingCards = DECK_SIZE - CARDS_PER_PART;
  const data = Buffer.alloc(remainingCards * COMPRESSED_POINT_SIZE);
  for (let i = 0; i < remainingCards; i++) {
    const cardIndex = CARDS_PER_PART + i;
    const point = workDeck[cardIndex];
    const compressed = compressPoint(point);
    Buffer.from(compressed).copy(data, i * COMPRESSED_POINT_SIZE);
  }

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.accumulator, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
      { pubkey: player.playerState, isSigner: false, isWritable: true },
    ],
    programId,
    data: buildInstruction(Instruction.MapDeckPart2, data),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Map deck - wrapper that calls Part1 and Part2
 * Stores the original deck points in the accumulator for card identification
 */
export async function mapDeckWithParts(
  player: PlayerData,
  gameAccounts: GameAccounts,
  workDeck: any[]
): Promise<void> {
  await mapDeckPart1(player, gameAccounts, workDeck);
  await mapDeckPart2(player, gameAccounts, workDeck);
}

/**
 * Shuffle deck instruction (split into 2 transactions with compressed points)
 * Part1: cards 0-25 (26 x 33 bytes = 858 bytes)
 * Part2: cards 26-51 (26 x 33 bytes = 858 bytes)
 */
export async function shuffleDeck(
  player: PlayerData,
  gameAccounts: GameAccounts,
  currentDeck: any[],
  playerKey: string
): Promise<any[]> {
  // Encrypt and shuffle the deck
  const encrypted = encryptWorkDeck(currentDeck, playerKey);
  const shuffled = shuffleWorkDeck(encrypted);

  // Send Part1 (cards 0-25)
  await shuffleDeckPart1(player, gameAccounts, shuffled);

  // Send Part2 (cards 26-51)
  await shuffleDeckPart2(player, gameAccounts, shuffled);

  return shuffled;
}

/**
 * Shuffle deck Part1 - submit compressed points for cards 0-25
 */
async function shuffleDeckPart1(
  player: PlayerData,
  gameAccounts: GameAccounts,
  shuffledDeck: any[]
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  // Build data: 26 compressed points (26 x 33 bytes)
  const data = Buffer.alloc(CARDS_PER_PART * COMPRESSED_POINT_SIZE);
  for (let i = 0; i < CARDS_PER_PART; i++) {
    const compressed = compressPoint(shuffledDeck[i]);
    Buffer.from(compressed).copy(data, i * COMPRESSED_POINT_SIZE);
  }

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.deckState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
      { pubkey: player.playerState, isSigner: false, isWritable: true },
    ],
    programId,
    data: buildInstruction(Instruction.ShufflePart1, data),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Shuffle deck Part2 - submit compressed points for cards 26-51
 */
async function shuffleDeckPart2(
  player: PlayerData,
  gameAccounts: GameAccounts,
  shuffledDeck: any[]
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  // Build data: 26 compressed points (26 x 33 bytes)
  const remainingCards = DECK_SIZE - CARDS_PER_PART;
  const data = Buffer.alloc(remainingCards * COMPRESSED_POINT_SIZE);
  for (let i = 0; i < remainingCards; i++) {
    const cardIndex = CARDS_PER_PART + i;
    const compressed = compressPoint(shuffledDeck[cardIndex]);
    Buffer.from(compressed).copy(data, i * COMPRESSED_POINT_SIZE);
  }

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.deckState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
      { pubkey: player.playerState, isSigner: false, isWritable: true },
    ],
    programId,
    data: buildInstruction(Instruction.ShufflePart2, data),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Lock cards instruction (split into 2 transactions with compressed points)
 * Part1: cards 0-25 (26 x 33 bytes = 858 bytes)
 * Part2: cards 26-51 (26 x 33 bytes = 858 bytes)
 */
export async function lockCards(
  player: PlayerData,
  gameAccounts: GameAccounts,
  currentDeck: any[]
): Promise<any[]> {
  // Lock the deck with player's lock vector
  const locked = lockWorkDeck(currentDeck, player.lockVector);

  // Send Part1 (cards 0-25)
  await lockCardsPart1(player, gameAccounts, locked);

  // Send Part2 (cards 26-51)
  await lockCardsPart2(player, gameAccounts, locked);

  return locked;
}

/**
 * Lock cards Part1 - submit compressed points for cards 0-25
 */
async function lockCardsPart1(
  player: PlayerData,
  gameAccounts: GameAccounts,
  lockedDeck: any[]
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  // Build data: 26 compressed points (26 x 33 bytes)
  const data = Buffer.alloc(CARDS_PER_PART * COMPRESSED_POINT_SIZE);
  for (let i = 0; i < CARDS_PER_PART; i++) {
    const compressed = compressPoint(lockedDeck[i]);
    Buffer.from(compressed).copy(data, i * COMPRESSED_POINT_SIZE);
  }

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.deckState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
      { pubkey: player.playerState, isSigner: false, isWritable: true },
    ],
    programId,
    data: buildInstruction(Instruction.LockPart1, data),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Lock cards Part2 - submit compressed points for cards 26-51
 */
async function lockCardsPart2(
  player: PlayerData,
  gameAccounts: GameAccounts,
  lockedDeck: any[]
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  // Build data: 26 compressed points (26 x 33 bytes)
  const remainingCards = DECK_SIZE - CARDS_PER_PART;
  const data = Buffer.alloc(remainingCards * COMPRESSED_POINT_SIZE);
  for (let i = 0; i < remainingCards; i++) {
    const cardIndex = CARDS_PER_PART + i;
    const compressed = compressPoint(lockedDeck[cardIndex]);
    Buffer.from(compressed).copy(data, i * COMPRESSED_POINT_SIZE);
  }

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.deckState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
      { pubkey: player.playerState, isSigner: false, isWritable: true },
    ],
    programId,
    data: buildInstruction(Instruction.LockPart2, data),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Place blind instruction
 * Data: amount(8 bytes)
 */
export async function placeBlind(
  player: PlayerData,
  gameAccounts: GameAccounts,
  amount: bigint
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(amount, 0);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: player.playerState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
    ],
    programId,
    data: buildInstruction(Instruction.PlaceBlind, data),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Place blinds for small and big blind
 */
export async function placeBlinds(
  players: PlayerData[],
  gameAccounts: GameAccounts,
  dealerIndex: number,
  smallBlind: bigint
): Promise<void> {
  const playerCount = players.length;

  // Small blind is first after dealer
  const sbIndex = (dealerIndex + 1) % playerCount;
  await placeBlind(players[sbIndex], gameAccounts, smallBlind);

  // Big blind is second after dealer
  const bbIndex = (dealerIndex + 2) % playerCount;
  await placeBlind(players[bbIndex], gameAccounts, smallBlind * 2n);
}

/**
 * Draw card instruction
 */
export async function draw(
  player: PlayerData,
  gameAccounts: GameAccounts
): Promise<number> {
  const connection = getConnection();
  const programId = getProgramId();

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: player.playerState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.deckState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: true },
    ],
    programId,
    data: buildInstruction(Instruction.Draw),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });

  // Read the game state to get the actual card index that was drawn
  const gameState = await fetchGameState(gameAccounts.gameState);
  return gameState.cardToReveal;
}

/**
 * Reveal card instruction (other players decrypt a drawn card)
 * Data: inv_key(32) + index(1) = 33 bytes
 * The inverse key is computed off-chain to avoid expensive on-chain computation
 */
export async function reveal(
  player: PlayerData,
  gameAccounts: GameAccounts,
  cardIndex: number,
  lockKey: string
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  // Compute the modular inverse of the lock key off-chain
  const invKey = modInverse(lockKey);
  const invKeyBytes = keyToBytes(invKey);

  const data = Buffer.alloc(33);
  Buffer.from(invKeyBytes).copy(data, 0);
  data.writeUInt8(cardIndex, 32);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.deckState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: true },
    ],
    programId,
    data: buildInstruction(Instruction.RevealCard, data),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Draw and reveal cards for all players
 */
export async function drawAndRevealCards(
  players: PlayerData[],
  gameAccounts: GameAccounts,
  startingPlayerIndex: number
): Promise<number[][]> {
  const playerCount = players.length;
  const playerCards: number[][] = Array.from({ length: playerCount }, () => []);

  // Each player draws 2 cards
  for (let c = 0; c < 2; c++) {
    for (let i = 0; i < playerCount; i++) {
      const playerIndex = (startingPlayerIndex + i) % playerCount;
      const player = players[playerIndex];

      // Player draws a card
      const cardDrawn = await draw(player, gameAccounts);
      playerCards[playerIndex].push(cardDrawn);

      // Other players reveal (decrypt) the card
      for (let y = 0; y < playerCount; y++) {
        if (y === playerIndex) continue;

        await reveal(
          players[y],
          gameAccounts,
          cardDrawn,
          players[y].lockVector[cardDrawn]
        );
      }
    }
  }

  return playerCards;
}

/**
 * Bet instruction
 * Data: amount(8 bytes)
 */
export async function bet(
  player: PlayerData,
  gameAccounts: GameAccounts,
  amount: bigint
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(amount, 0);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: player.playerState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
    ],
    programId,
    data: buildInstruction(Instruction.Bet, data),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Call instruction (bet to match current call amount)
 */
export async function call(
  player: PlayerData,
  gameAccounts: GameAccounts,
  amount: bigint = 0n
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  // Call = bet the amount needed to match current call
  const amountData = Buffer.alloc(8);
  amountData.writeBigUInt64LE(amount, 0);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: player.playerState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
    ],
    programId,
    data: buildInstruction(Instruction.Bet, amountData),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Fold instruction
 */
export async function fold(
  player: PlayerData,
  gameAccounts: GameAccounts
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: player.playerState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
    ],
    programId,
    data: buildInstruction(Instruction.Fold),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Check instruction
 */
export async function check(
  player: PlayerData,
  gameAccounts: GameAccounts
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  // Check = bet 0 (when no one has bet)
  const amountData = Buffer.alloc(8);
  amountData.writeBigUInt64LE(0n, 0);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: player.playerState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
    ],
    programId,
    data: buildInstruction(Instruction.Bet, amountData),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Everyone calls (betting round helper)
 */
export async function everyoneCalls(
  players: PlayerData[],
  gameAccounts: GameAccounts,
  startingPlayerIndex: number,
  foldedPlayers: number[] = []
): Promise<void> {
  const playerCount = players.length;

  for (let i = 0; i < playerCount; i++) {
    const playerIndex = (startingPlayerIndex + i) % playerCount;

    if (foldedPlayers.includes(playerIndex)) {
      continue;
    }

    // Fetch game state to get current call amount
    const gameState = await fetchGameState(gameAccounts.gameState);

    // Fetch player state to get their current bet
    const playerState = await fetchPlayerState(players[playerIndex].playerState);

    // Calculate amount needed to call
    const amountToCall = gameState.currentCallAmount - playerState.currentBet;

    await call(players[playerIndex], gameAccounts, amountToCall);
  }
}

/**
 * Deal community cards instruction
 */
export async function dealCommunityCards(
  dealer: PlayerData,
  gameAccounts: GameAccounts
): Promise<number[]> {
  const connection = getConnection();
  const programId = getProgramId();

  // Get cards_left_in_deck before dealing
  const stateBefore = await fetchGameState(gameAccounts.gameState);
  const cardsLeftBefore = stateBefore.cardsLeftInDeck;

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: dealer.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.deckState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.communityCards, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: true },
    ],
    programId,
    data: buildInstruction(Instruction.DealCommunityCard),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [dealer.keypair], {
    commitment: 'confirmed',
  });

  // Get cards_left_in_deck after dealing
  const stateAfter = await fetchGameState(gameAccounts.gameState);
  const cardsLeftAfter = stateAfter.cardsLeftInDeck;

  // Calculate the card indices that were dealt
  // Cards are dealt from the end of the deck: card_index = cards_left_in_deck (before decrement)
  const cardsDealt = cardsLeftBefore - cardsLeftAfter;
  const cardIndices: number[] = [];
  for (let i = 0; i < cardsDealt; i++) {
    cardIndices.push(cardsLeftBefore - 1 - i);
  }

  return cardIndices;
}

/**
 * Open community card instruction
 * Data: inv_key(32) + index(1) = 33 bytes
 * The inverse key is computed off-chain to avoid expensive on-chain computation
 */
export async function openCommunityCard(
  player: PlayerData,
  gameAccounts: GameAccounts,
  cardIndex: number,
  lockKey: string
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  // Compute the modular inverse of the lock key off-chain
  const invKey = modInverse(lockKey);
  const invKeyBytes = keyToBytes(invKey);

  const data = Buffer.alloc(33);
  Buffer.from(invKeyBytes).copy(data, 0);
  data.writeUInt8(cardIndex, 32);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.deckState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.communityCards, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
    ],
    programId,
    data: buildInstruction(Instruction.OpenCommunityCard, data),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Deal and open community cards (flop/turn/river helper)
 * @param numCards Number of cards to deal (3 for flop, 1 for turn/river)
 */
export async function dealCommunityCardWithReveals(
  players: PlayerData[],
  gameAccounts: GameAccounts,
  dealerIndex: number,
  numCards: number = 1
): Promise<number[]> {
  const dealer = players[dealerIndex];
  const playerCount = players.length;

  const openedCardIndices: number[] = [];

  // Deal cards one at a time
  for (let cardNum = 0; cardNum < numCards; cardNum++) {
    // Dealer deals ONE community card
    const cardIndices = await dealCommunityCards(dealer, gameAccounts);

    if (cardIndices.length === 0) {
      throw new Error('No card was dealt');
    }

    const cardIndex = cardIndices[0];
    openedCardIndices.push(cardIndex);

    // All non-dealer players reveal for this card
    for (let y = 0; y < playerCount; y++) {
      if (y === dealerIndex) continue;

      await reveal(
        players[y],
        gameAccounts,
        cardIndex,
        players[y].lockVector[cardIndex]
      );
    }

    // Dealer opens the community card
    await openCommunityCard(
      dealer,
      gameAccounts,
      cardIndex,
      dealer.lockVector[cardIndex]
    );
  }

  return openedCardIndices;
}

/**
 * Open player's hole card instruction
 * Data: inv_key(32) + index(1) = 33 bytes
 * The inverse key is computed off-chain to avoid expensive on-chain computation
 */
export async function openCard(
  player: PlayerData,
  gameAccounts: GameAccounts,
  cardIndex: number,
  lockKey: string
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  // Compute the modular inverse of the lock key off-chain
  const invKey = modInverse(lockKey);
  const invKeyBytes = keyToBytes(invKey);

  const data = Buffer.alloc(33);
  Buffer.from(invKeyBytes).copy(data, 0);
  data.writeUInt8(cardIndex, 32);

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: player.playerState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.deckState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.communityCards, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
    ],
    programId,
    data: buildInstruction(Instruction.OpenCard, data),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Open all player hole cards in showdown
 */
export async function openCards(
  players: PlayerData[],
  gameAccounts: GameAccounts,
  startingPlayerIndex: number,
  foldedPlayers: number[],
  cardsOwned: number[][]
): Promise<any[][]> {
  const playerCount = players.length;
  const cardsOpened: any[][] = Array.from({ length: playerCount }, () => []);

  for (let i = 0; i < playerCount; i++) {
    const playerIndex = (startingPlayerIndex + i) % playerCount;

    if (foldedPlayers.includes(playerIndex)) {
      continue;
    }

    const player = players[playerIndex];
    const playerCardIndices = cardsOwned[playerIndex];

    for (const cardIndex of playerCardIndices) {
      await openCard(
        player,
        gameAccounts,
        cardIndex,
        player.lockVector[cardIndex]
      );
      // Would push opened card point here
    }
  }

  return cardsOpened;
}

/**
 * Submit best hand instruction
 * Data: 5 EC points (5 x 64 bytes = 320 bytes)
 */
export async function submitBestHand(
  player: PlayerData,
  gameAccounts: GameAccounts,
  bestHandPoints: any[]
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  // Build data: 5 x 64 bytes
  const data = Buffer.alloc(5 * 64);
  for (let i = 0; i < 5; i++) {
    const pointBytes = pointToBytes(bestHandPoints[i]);
    Buffer.from(pointBytes).copy(data, i * 64);
  }

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: player.playerState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.accumulator, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.communityCards, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
    ],
    programId,
    data: buildInstruction(Instruction.SubmitBestHand, data),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Claim pot instruction
 */
export async function claimPot(
  dealer: PlayerData,
  gameAccounts: GameAccounts,
  allPlayerStates: PublicKey[],
  potAccount: PublicKey,
  winnerTokenAccounts: PublicKey[]
): Promise<PublicKey[]> {
  const connection = getConnection();
  const programId = getProgramId();

  const keys = [
    { pubkey: dealer.keypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
    { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
    { pubkey: potAccount, isSigner: false, isWritable: true },
    { pubkey: dealer.tokenAccount, isSigner: false, isWritable: true },
    { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Add all player state accounts
  for (const playerState of allPlayerStates) {
    keys.push({ pubkey: playerState, isSigner: false, isWritable: false });
  }

  // Add winner token accounts
  for (const winnerToken of winnerTokenAccounts) {
    keys.push({ pubkey: winnerToken, isSigner: false, isWritable: true });
  }

  const ix = new TransactionInstruction({
    keys,
    programId,
    data: buildInstruction(Instruction.ClaimPot),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [dealer.keypair], {
    commitment: 'confirmed',
  });

  // Return winners - would parse from logs
  return [];
}

/**
 * Start next game instruction
 */
export async function startNextGame(
  player: PlayerData,
  gameAccounts: GameAccounts,
  allPlayerStates?: PublicKey[]
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  const keys = [
    { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
    { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: true },
    { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
    { pubkey: gameAccounts.deckState, isSigner: false, isWritable: true },
    { pubkey: gameAccounts.accumulator, isSigner: false, isWritable: true },
    { pubkey: gameAccounts.communityCards, isSigner: false, isWritable: true },
    { pubkey: gameAccounts.playerList, isSigner: false, isWritable: true },
  ];

  // Add player state accounts if provided
  if (allPlayerStates) {
    for (const ps of allPlayerStates) {
      keys.push({ pubkey: ps, isSigner: false, isWritable: true });
    }
  }

  const ix = new TransactionInstruction({
    keys,
    programId,
    data: buildInstruction(Instruction.StartNextGame),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Slash instruction (penalize inactive player)
 */
export async function slash(
  caller: PlayerData,
  gameAccounts: GameAccounts,
  offenderState: PublicKey,
  chipVault: PublicKey,
  slashRecipient: PublicKey
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: caller.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: false },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: offenderState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: false },
      { pubkey: chipVault, isSigner: false, isWritable: true },
      { pubkey: slashRecipient, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId,
    data: buildInstruction(Instruction.Leave), // Note: Slash might be a different instruction number
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [caller.keypair], {
    commitment: 'confirmed',
  });
}

/**
 * Leave game instruction
 */
export async function leaveGame(
  player: PlayerData,
  gameAccounts: GameAccounts
): Promise<void> {
  const connection = getConnection();
  const programId = getProgramId();

  const ix = new TransactionInstruction({
    keys: [
      { pubkey: player.keypair.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAccounts.gameConfig, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.gameState, isSigner: false, isWritable: true },
      { pubkey: player.playerState, isSigner: false, isWritable: true },
      { pubkey: gameAccounts.playerList, isSigner: false, isWritable: true },
    ],
    programId,
    data: buildInstruction(Instruction.Leave),
  });

  const tx = new Transaction().add(ix);
  await sendAndConfirmTransaction(connection, tx, [player.keypair], {
    commitment: 'confirmed',
  });
}
