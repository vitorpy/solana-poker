/**
 * Full Texas Hold'em Game Flow Integration Test
 *
 * Tests the complete game flow from initialization to pot distribution.
 * Based on moonpoker-contracts/test/texas_hold_em_game.test.js
 */

import {
  startValidator,
  stopValidator,
  getConnection,
  getProgramId,
  createFundedPayer,
} from '../helpers/validator';
import {
  setupCompleteGame,
  initializeGame,
  createPlayer,
  joinGame,
  GameAccounts,
  PlayerData,
  getTokenAmount,
  fetchGameState,
  fetchGameConfig,
  derivePlayerState,
  GamePhase,
  ShufflingState,
  BettingRoundState,
  TexasHoldEmState,
  DECK_SIZE,
  MAX_PLAYERS,
} from '../helpers/setup';
import {
  generateShuffleVector,
  mapDeckWithParts,
  shuffleDeck,
  lockCards,
  placeBlinds,
  placeBlind,
  draw,
  reveal,
  drawAndRevealCards,
  bet,
  call,
  fold,
  check,
  everyoneCalls,
  dealCommunityCards,
  dealCommunityCardWithReveals,
  openCommunityCard,
  openCard,
  openCards,
  submitBestHand,
  claimPot,
  startNextGame,
} from '../helpers/actions';
import {
  generateRandomArray,
  generateWorkDeck,
  encryptWorkDeck,
  shuffleWorkDeck,
  lockWorkDeck,
  transformPointArrayToTupleArray,
  transformTupleArrayToPointArray,
  decryptWorkDeck,
  unlockCard,
  getCardName,
  calculateKeccak256Hash,
} from '../helpers/crypto';
import {
  selectBestHand,
  selectBestHandPoints,
  getHandName,
  HandEnum,
} from '../helpers/hand-analyzer';
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

// Test configuration
const PLAYER_COUNT = 2; // Start with 2 players for simplicity
const SMALL_BLIND = getTokenAmount(10);
const BIG_BLIND = SMALL_BLIND * 2n;
const MIN_BUY_IN = getTokenAmount(100);
const BUY_IN_AMOUNT = getTokenAmount(1000);

describe('Texas Hold\'em - Full Game Flow', () => {
  // Game state
  let authority: Keypair;
  let tokenMint: Keypair;
  let gameAccounts: GameAccounts;
  let players: PlayerData[];

  // Crypto state
  let playerPrivateKeys: string[] = [];
  let accumulator: string[] = [];
  let workDeck: any[] = [];
  let locks: string[][] = [];
  let revealedWorkdeck: any[] = [];

  // Turn tracking
  let dealerIndex = 0;
  let startingPlayerIndex: number;

  // Card tracking
  let playerCards: number[][] = [];
  // Original work deck (before shuffle/encrypt) for hand submission
  let originalWorkDeck: any[] = [];
  // Community card indices
  let communityCardIndices: number[] = [];

  beforeAll(async () => {
    // Start the test validator with the poker program
    await startValidator();
  }, 60000);

  afterAll(async () => {
    await stopValidator();
  }, 10000);

  beforeEach(async () => {
    // Generate player private keys for encryption
    playerPrivateKeys = Array.from({ length: PLAYER_COUNT }, () =>
      generateRandomArray()[0]
    );

    // Reset turn tracking
    dealerIndex = 0;
    startingPlayerIndex = (dealerIndex + 3) % PLAYER_COUNT;
  });

  describe('Game Setup', () => {
    it('should initialize a new game', async () => {
      // Create authority and token mint
      authority = await createFundedPayer(10 * LAMPORTS_PER_SOL);
      const { createTokenMint } = await import('../helpers/setup');
      tokenMint = await createTokenMint(authority, authority.publicKey);

      // Initialize game
      gameAccounts = await initializeGame(
        authority,
        tokenMint.publicKey,
        PLAYER_COUNT,
        SMALL_BLIND,
        MIN_BUY_IN
      );

      // Verify game was created
      expect(gameAccounts.gameConfig).toBeDefined();
      expect(gameAccounts.gameState).toBeDefined();

      // Fetch and verify game config
      const config = await fetchGameConfig(gameAccounts.gameConfig);
      expect(config.maxPlayers).toBe(PLAYER_COUNT);
      expect(config.smallBlind).toBe(SMALL_BLIND);
      expect(config.isAcceptingPlayers).toBe(true);
    });

    it('should allow players to join the game', async () => {
      players = [];

      for (let i = 0; i < PLAYER_COUNT; i++) {
        const player = await createPlayer(
          authority,
          gameAccounts,
          tokenMint.publicKey,
          BUY_IN_AMOUNT
        );
        await joinGame(player, gameAccounts, BUY_IN_AMOUNT);
        players.push(player);
      }

      // Verify all players joined
      expect(players.length).toBe(PLAYER_COUNT);

      // Fetch game config to check player count
      const config = await fetchGameConfig(gameAccounts.gameConfig);
      expect(config.currentPlayers).toBe(PLAYER_COUNT);
    });
  });

  describe('Shuffling Phase', () => {
    it('should complete the commit phase when players join', async () => {
      // Players already joined with commitments in beforeEach
      // Verify shuffling state is at Generating
      const state = await fetchGameState(gameAccounts.gameState);
      expect(state.shufflingState).toBe(ShufflingState.Generating);
    });

    it('should generate shuffle vectors', async () => {
      // Build accumulator from player shuffle vectors
      // Must follow turn order starting from startingPlayerIndex
      accumulator = new Array(DECK_SIZE).fill('0x0');

      for (let i = 0; i < PLAYER_COUNT; i++) {
        const playerIndex = (startingPlayerIndex + i) % PLAYER_COUNT;
        const player = players[playerIndex];

        // Generate shuffle vector
        await generateShuffleVector(player, gameAccounts);

        // Add to local accumulator
        for (let j = 0; j < DECK_SIZE; j++) {
          // Add values (in a real implementation, would do proper modular addition)
          const current = BigInt(accumulator[j]);
          const addition = BigInt(player.shuffleVector[j]);
          accumulator[j] = '0x' + ((current + addition) % (2n ** 256n)).toString(16);
        }
      }

      // Verify shuffling state moved to Shuffling
      const state = await fetchGameState(gameAccounts.gameState);
      expect(state.shufflingState).toBe(ShufflingState.Shuffling);
    });

    it('should shuffle the deck', async () => {
      // Generate initial work deck from accumulator
      workDeck = generateWorkDeck(accumulator);

      // Save original work deck for hand submission (accumulator stores these points)
      originalWorkDeck = [...workDeck];

      // First player maps the original deck to the accumulator (for card identification later)
      const firstPlayerIndex = startingPlayerIndex;
      await mapDeckWithParts(players[firstPlayerIndex], gameAccounts, workDeck);

      // Each player encrypts and shuffles - must follow turn order
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const playerIndex = (startingPlayerIndex + i) % PLAYER_COUNT;
        const player = players[playerIndex];
        workDeck = await shuffleDeck(
          player,
          gameAccounts,
          workDeck,
          playerPrivateKeys[playerIndex]
        );
      }

      // Verify shuffling state moved to Locking
      const state = await fetchGameState(gameAccounts.gameState);
      expect(state.shufflingState).toBe(ShufflingState.Locking);
    });

    it('should lock the cards', async () => {
      // Each player locks the deck with their lock vector - must follow turn order
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const playerIndex = (startingPlayerIndex + i) % PLAYER_COUNT;
        const player = players[playerIndex];
        workDeck = await lockCards(player, gameAccounts, workDeck);
        locks.push(player.lockVector);
      }

      // Verify game moved to Drawing phase
      const state = await fetchGameState(gameAccounts.gameState);
      expect(state.gamePhase).toBe(GamePhase.Drawing);
    });
  });

  describe('Betting - Blinds', () => {
    it('should place small blind', async () => {
      const sbIndex = (dealerIndex + 1) % PLAYER_COUNT;
      const sbPlayer = players[sbIndex];

      await placeBlind(sbPlayer, gameAccounts, SMALL_BLIND);

      // Verify pot updated
      const state = await fetchGameState(gameAccounts.gameState);
      expect(state.pot).toBe(SMALL_BLIND);
    });

    it('should place big blind', async () => {
      const bbIndex = (dealerIndex + 2) % PLAYER_COUNT;
      const bbPlayer = players[bbIndex];

      await placeBlind(bbPlayer, gameAccounts, BIG_BLIND);

      // Verify pot updated
      const state = await fetchGameState(gameAccounts.gameState);
      expect(state.pot).toBe(SMALL_BLIND + BIG_BLIND);
    });
  });

  describe('Pre-Flop - Drawing Cards', () => {
    it('should draw and reveal hole cards for all players', async () => {
      playerCards = await drawAndRevealCards(
        players,
        gameAccounts,
        startingPlayerIndex
      );

      // Each player should have 2 cards
      for (let i = 0; i < PLAYER_COUNT; i++) {
        expect(playerCards[i].length).toBe(2);
      }

      // Verify state moved to Pre-Flop betting
      const state = await fetchGameState(gameAccounts.gameState);
      expect(state.bettingRoundState).toBe(BettingRoundState.PreFlop);
    });

    it('should complete pre-flop betting round', async () => {
      // Everyone calls the big blind
      await everyoneCalls(players, gameAccounts, startingPlayerIndex);

      // Verify betting round complete
      const state = await fetchGameState(gameAccounts.gameState);
      // State should move to community cards dealing
    });
  });

  describe('Community Cards - Flop', () => {
    it('should deal the flop (3 cards)', async () => {
      const dealer = players[dealerIndex];

      // Deal 3 community cards (one at a time)
      const flopIndices = await dealCommunityCardWithReveals(players, gameAccounts, dealerIndex, 3);
      communityCardIndices.push(...flopIndices);

      // Verify 3 community cards dealt
      expect(flopIndices.length).toBe(3);
    });

    it('should complete post-flop betting', async () => {
      // Everyone checks
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const playerIndex = (dealerIndex + 1 + i) % PLAYER_COUNT;
        await check(players[playerIndex], gameAccounts);
      }

      const state = await fetchGameState(gameAccounts.gameState);
      expect(state.bettingRoundState).toBe(BettingRoundState.PostFlop);
    });
  });

  describe('Community Cards - Turn', () => {
    it('should deal the turn (4th card)', async () => {
      const turnIndices = await dealCommunityCardWithReveals(players, gameAccounts, dealerIndex);
      communityCardIndices.push(...turnIndices);
      expect(turnIndices.length).toBe(1);
    });

    it('should complete post-turn betting', async () => {
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const playerIndex = (dealerIndex + 1 + i) % PLAYER_COUNT;
        await check(players[playerIndex], gameAccounts);
      }
    });
  });

  describe('Community Cards - River', () => {
    it('should deal the river (5th card)', async () => {
      const riverIndices = await dealCommunityCardWithReveals(players, gameAccounts, dealerIndex);
      communityCardIndices.push(...riverIndices);
      expect(riverIndices.length).toBe(1);
    });

    it('should complete final betting round', async () => {
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const playerIndex = (dealerIndex + 1 + i) % PLAYER_COUNT;
        await check(players[playerIndex], gameAccounts);
      }

      const state = await fetchGameState(gameAccounts.gameState);
      expect(state.bettingRoundState).toBe(BettingRoundState.Showdown);
    });
  });

  describe('Showdown', () => {
    let playerHoleCards: any[][] = [];

    it('should open player hole cards', async () => {
      const foldedPlayers: number[] = [];

      // Each player opens their hole cards (starting from dealer after showdown betting)
      for (let i = 0; i < PLAYER_COUNT; i++) {
        const playerIndex = (dealerIndex + i) % PLAYER_COUNT;

        if (foldedPlayers.includes(playerIndex)) continue;

        const player = players[playerIndex];
        // Get the actual hole card indices for this player from playerCards array
        const cardIndices = playerCards[playerIndex] || [];

        for (const cardIdx of cardIndices) {
          await openCard(
            player,
            gameAccounts,
            cardIdx,
            player.lockVector[cardIdx]
          );
        }
      }
    });

    it('should submit best hands', async () => {
      const foldedPlayers: number[] = [];

      for (let i = 0; i < PLAYER_COUNT; i++) {
        const playerIndex = (startingPlayerIndex + i) % PLAYER_COUNT;

        if (foldedPlayers.includes(playerIndex)) continue;

        const player = players[playerIndex];

        // Get player's hole cards (2 cards)
        const holeCardIndices = playerCards[playerIndex];

        // Build 5-card hand: 2 hole cards + 3 community cards
        // Use originalWorkDeck which has the points matching the accumulator
        const handCardIndices = [
          holeCardIndices[0],
          holeCardIndices[1],
          communityCardIndices[0],
          communityCardIndices[1],
          communityCardIndices[2],
        ];

        const bestHand = handCardIndices.map(idx => originalWorkDeck[idx]);
        await submitBestHand(player, gameAccounts, bestHand);
      }
    });
  });

  describe('Pot Distribution', () => {
    it('should claim and distribute the pot', async () => {
      const dealer = players[dealerIndex];

      // Get all player state accounts - must pass MAX_PLAYERS slots
      // Pad with gameState for missing players (will be skipped by on-chain code)
      const playerStates = players.map(p => p.playerState);
      while (playerStates.length < MAX_PLAYERS) {
        playerStates.push(gameAccounts.gameState); // padding
      }

      // Claim pot
      await claimPot(
        dealer,
        gameAccounts,
        playerStates,
        gameAccounts.vault, // pot account
        players.map(p => p.tokenAccount) // winner token accounts
      );

      // Verify pot is empty
      const state = await fetchGameState(gameAccounts.gameState);
      expect(state.pot).toBe(0n);
    });
  });

  describe('Next Game', () => {
    it('should start the next game', async () => {
      const dealer = players[dealerIndex];

      // Get all player state accounts - pad to MAX_PLAYERS
      const playerStates = players.map(p => p.playerState);
      while (playerStates.length < MAX_PLAYERS) {
        playerStates.push(gameAccounts.gameState); // padding
      }

      await startNextGame(dealer, gameAccounts, playerStates);

      // Verify game reset
      const state = await fetchGameState(gameAccounts.gameState);
      expect(state.gamePhase).toBe(GamePhase.Shuffling);
    });
  });
});

describe('Texas Hold\'em - Early Fold', () => {
  let authority: Keypair;
  let tokenMint: Keypair;
  let gameAccounts: GameAccounts;
  let players: PlayerData[];

  beforeAll(async () => {
    // Reuse validator from previous tests
  }, 10000);

  it('should end game early when all but one player folds', async () => {
    // Setup a new game
    const setup = await setupCompleteGame(
      2,
      getTokenAmount(10),
      getTokenAmount(100),
      getTokenAmount(1000)
    );

    authority = setup.authority;
    tokenMint = setup.tokenMint;
    gameAccounts = setup.gameAccounts;
    players = setup.players;

    // Go through shuffling phase (simplified)
    // ...

    // Place blinds
    await placeBlind(players[1], gameAccounts, getTokenAmount(10));
    await placeBlind(players[0], gameAccounts, getTokenAmount(20));

    // Draw cards (simplified)
    // ...

    // Player 0 folds
    await fold(players[0], gameAccounts);

    // Game should end - only player 1 remaining
    const state = await fetchGameState(gameAccounts.gameState);
    expect(state.texasState).toBe(TexasHoldEmState.ClaimPot);
  });
});

describe('Texas Hold\'em - Betting Actions', () => {
  let gameAccounts: GameAccounts;
  let players: PlayerData[];

  it('should allow raise and re-raise', async () => {
    const setup = await setupCompleteGame(
      3,
      getTokenAmount(10),
      getTokenAmount(100),
      getTokenAmount(1000)
    );

    players = setup.players;
    gameAccounts = setup.gameAccounts;

    // Place blinds
    await placeBlind(players[1], gameAccounts, getTokenAmount(10));
    await placeBlind(players[2], gameAccounts, getTokenAmount(20));

    // Player 0 raises
    await bet(players[0], gameAccounts, getTokenAmount(40));

    // Player 1 re-raises
    await bet(players[1], gameAccounts, getTokenAmount(80));

    // Verify pot
    const state = await fetchGameState(gameAccounts.gameState);
    expect(state.currentCallAmount).toBe(getTokenAmount(80));
  });
});
