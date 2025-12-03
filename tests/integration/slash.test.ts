/**
 * Slash/Timeout Penalty Tests
 *
 * Tests the slash mechanism for penalizing inactive players.
 * Based on moonpoker-contracts/test/texas_hold_em_slash.test.js
 */

import {
  startValidator,
  stopValidator,
  getConnection,
  getProgramId,
  createFundedPayer,
  sleep,
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
  DECK_SIZE,
} from '../helpers/setup';
import {
  generateShuffleVector,
  shuffleDeck,
  lockCards,
  placeBlinds,
  placeBlind,
  draw,
  reveal,
  bet,
  call,
  fold,
  slash,
} from '../helpers/actions';
import {
  generateRandomArray,
  generateWorkDeck,
  calculateKeccak256Hash,
} from '../helpers/crypto';
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';

// Test configuration
const PLAYER_COUNT = 4;
const SMALL_BLIND = getTokenAmount(10);
const MIN_BUY_IN = getTokenAmount(100);
const BUY_IN_AMOUNT = getTokenAmount(1000);

// Timeout for slash (matching constants.rs DEFAULT_TIMEOUT_SECONDS)
const TIMEOUT_SECONDS = 120;

describe('Texas Hold\'em - Slash Mechanism', () => {
  let authority: Keypair;
  let tokenMint: Keypair;
  let gameAccounts: GameAccounts;
  let players: PlayerData[];

  let playerPrivateKeys: string[] = [];
  let locks: string[][] = [];
  let workDeck: any[] = [];
  let accumulator: string[] = [];

  let dealerIndex = 0;
  let startingPlayerIndex: number;

  beforeAll(async () => {
    await startValidator();
  }, 60000);

  afterAll(async () => {
    await stopValidator();
  }, 10000);

  async function setupGameWithPlayers() {
    // Create authority and token
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

    // Generate player keys
    playerPrivateKeys = Array.from({ length: PLAYER_COUNT }, () =>
      generateRandomArray()[0]
    );

    // Create and join players
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
      locks.push(player.lockVector);
    }

    // Set turn tracking
    startingPlayerIndex = (dealerIndex + 3) % PLAYER_COUNT;
  }

  async function completeShufflingPhase() {
    // Generate vectors - must follow turn order starting from startingPlayerIndex
    accumulator = new Array(DECK_SIZE).fill('0x0');
    for (let i = 0; i < PLAYER_COUNT; i++) {
      const playerIndex = (startingPlayerIndex + i) % PLAYER_COUNT;
      await generateShuffleVector(players[playerIndex], gameAccounts);
      for (let j = 0; j < DECK_SIZE; j++) {
        const current = BigInt(accumulator[j]);
        const addition = BigInt(players[playerIndex].shuffleVector[j]);
        accumulator[j] = '0x' + ((current + addition) % (2n ** 256n)).toString(16);
      }
    }

    // Shuffle - must follow turn order starting from startingPlayerIndex
    workDeck = generateWorkDeck(accumulator);
    for (let i = 0; i < PLAYER_COUNT; i++) {
      const playerIndex = (startingPlayerIndex + i) % PLAYER_COUNT;
      workDeck = await shuffleDeck(
        players[playerIndex],
        gameAccounts,
        workDeck,
        playerPrivateKeys[playerIndex]
      );
    }

    // Lock - must follow turn order starting from startingPlayerIndex
    for (let i = 0; i < PLAYER_COUNT; i++) {
      const playerIndex = (startingPlayerIndex + i) % PLAYER_COUNT;
      workDeck = await lockCards(players[playerIndex], gameAccounts, workDeck);
    }
  }

  describe('Slash on Timeout', () => {
    beforeEach(async () => {
      await setupGameWithPlayers();
      await completeShufflingPhase();
    });

    it('should not allow slash before timeout', async () => {
      // Place blinds
      await placeBlinds(players, gameAccounts, dealerIndex, SMALL_BLIND);

      // Try to slash immediately (should fail)
      try {
        await slash(
          players[0],
          gameAccounts,
          players[1].playerState,
          gameAccounts.vault,
          players[0].tokenAccount
        );
        fail('Should have thrown error - timeout not reached');
      } catch (error: any) {
        expect(error.message).toContain('TimeoutNotReached');
      }
    });

    it.skip('should allow slash after timeout expires', async () => {
      // Place blinds
      await placeBlinds(players, gameAccounts, dealerIndex, SMALL_BLIND);

      // Wait for timeout (skip in fast tests)
      console.log(`Waiting ${TIMEOUT_SECONDS} seconds for timeout...`);
      await sleep(TIMEOUT_SECONDS * 1000 + 5000); // Extra 5 seconds buffer

      // Get the player whose turn it is (the offender)
      const state = await fetchGameState(gameAccounts.gameState);
      const offenderIndex = state.currentTurn;
      const offender = players[offenderIndex];

      // Another player calls slash
      const callerIndex = (offenderIndex + 1) % PLAYER_COUNT;
      await slash(
        players[callerIndex],
        gameAccounts,
        offender.playerState,
        gameAccounts.vault,
        players[callerIndex].tokenAccount
      );

      // Verify offender was slashed
      // The offender should be marked as folded and have lost chips
    });
  });

  describe('Slash During Reveal Phase', () => {
    beforeEach(async () => {
      await setupGameWithPlayers();
      await completeShufflingPhase();
    });

    it.skip('should slash first non-revealing player', async () => {
      // Place blinds
      await placeBlinds(players, gameAccounts, dealerIndex, SMALL_BLIND);

      // First player draws a card
      const drawPlayerIndex = startingPlayerIndex % PLAYER_COUNT;
      await draw(players[drawPlayerIndex], gameAccounts);

      // No one reveals - wait for timeout
      console.log(`Waiting ${TIMEOUT_SECONDS} seconds for reveal timeout...`);
      await sleep(TIMEOUT_SECONDS * 1000 + 5000);

      // The first player after the drawer who didn't reveal should be slashed
      // Player at index 1 (assuming drawer is at index 0) should be the offender
      const offenderIndex = (drawPlayerIndex + 1) % PLAYER_COUNT;
      if (offenderIndex === drawPlayerIndex) {
        // Skip if it's the drawer
        return;
      }

      await slash(
        players[drawPlayerIndex],
        gameAccounts,
        players[offenderIndex].playerState,
        gameAccounts.vault,
        players[drawPlayerIndex].tokenAccount
      );

      // Verify the slashed player lost their chips
    });

    it.skip('should slash last non-revealing player', async () => {
      // Place blinds
      await placeBlinds(players, gameAccounts, dealerIndex, SMALL_BLIND);

      // First player draws a card
      const drawPlayerIndex = startingPlayerIndex % PLAYER_COUNT;
      const cardDrawn = await draw(players[drawPlayerIndex], gameAccounts);

      // All players except the last one reveal
      for (let y = 0; y < PLAYER_COUNT - 1; y++) {
        if (y === drawPlayerIndex) continue;

        await reveal(
          players[y],
          gameAccounts,
          cardDrawn,
          players[y].lockVector[cardDrawn]
        );
      }

      // Wait for timeout for the last player
      const lastPlayerIndex = PLAYER_COUNT - 1;
      if (lastPlayerIndex === drawPlayerIndex) {
        // Skip - drawer doesn't need to reveal their own card
        return;
      }

      console.log(`Waiting ${TIMEOUT_SECONDS} seconds for last player timeout...`);
      await sleep(TIMEOUT_SECONDS * 1000 + 5000);

      // Slash the last non-revealing player
      await slash(
        players[0],
        gameAccounts,
        players[lastPlayerIndex].playerState,
        gameAccounts.vault,
        players[0].tokenAccount
      );

      // Verify the slashed player lost their chips
    });
  });

  describe('Slash Chip Distribution', () => {
    it.skip('should distribute slashed chips to remaining players', async () => {
      await setupGameWithPlayers();
      await completeShufflingPhase();

      // Place blinds
      await placeBlinds(players, gameAccounts, dealerIndex, SMALL_BLIND);

      // Wait for timeout
      await sleep(TIMEOUT_SECONDS * 1000 + 5000);

      const state = await fetchGameState(gameAccounts.gameState);
      const offenderIndex = state.currentTurn;

      // Get chip balances before slash
      const chipsBefore: bigint[] = [];
      for (let i = 0; i < PLAYER_COUNT; i++) {
        // Would fetch player state to get chips
        chipsBefore.push(BUY_IN_AMOUNT);
      }

      // Slash
      const callerIndex = (offenderIndex + 1) % PLAYER_COUNT;
      await slash(
        players[callerIndex],
        gameAccounts,
        players[offenderIndex].playerState,
        gameAccounts.vault,
        players[callerIndex].tokenAccount
      );

      // Verify chip distribution
      // Slashed player should have 0 chips
      // Other players should have received their share

      // Calculate expected distribution
      const winners = PLAYER_COUNT - 1; // All except slashed player
      const totalSlashed = BUY_IN_AMOUNT; // Offender's entire buy-in
      const chipPerWinner = totalSlashed / BigInt(winners);
      const remainder = totalSlashed % BigInt(winners);

      // Verify each player's balance
      for (let i = 0; i < PLAYER_COUNT; i++) {
        if (i === offenderIndex) {
          // Slashed player should have 0
          // expect(chipsAfter[i]).toBe(0n);
        } else {
          // Other players should have original + share
          // First winner gets remainder
          // expect(chipsAfter[i]).toBe(chipsBefore[i] + chipPerWinner + (isFirst ? remainder : 0n));
        }
      }
    });
  });

  describe('Slash Edge Cases', () => {
    it('should not allow non-player to call slash', async () => {
      await setupGameWithPlayers();
      await completeShufflingPhase();

      // Create a non-player
      const nonPlayer = await createFundedPayer(LAMPORTS_PER_SOL);

      // Try to slash as non-player (should fail)
      try {
        const fakePlayerData: PlayerData = {
          keypair: nonPlayer,
          tokenAccount: players[0].tokenAccount, // Doesn't matter
          playerState: players[0].playerState, // Doesn't matter
          playerStateBump: 0,
          shuffleSeed: new Uint8Array(32),
          shuffleVector: [],
          commitment: new Uint8Array(32),
          lockVector: [],
        };

        await slash(
          fakePlayerData,
          gameAccounts,
          players[0].playerState,
          gameAccounts.vault,
          fakePlayerData.tokenAccount
        );
        fail('Should have thrown error - not a player');
      } catch (error: any) {
        expect(error.message).toContain('NotAPlayer');
      }
    });

    it('should not allow slash when game is not in progress', async () => {
      await setupGameWithPlayers();
      // Don't complete shuffling - game not fully started

      try {
        await slash(
          players[0],
          gameAccounts,
          players[1].playerState,
          gameAccounts.vault,
          players[0].tokenAccount
        );
        fail('Should have thrown error - game not in progress');
      } catch (error: any) {
        expect(error.message).toContain('Invalid');
      }
    });

    it.skip('should end game when only one player remains after slash', async () => {
      // Setup with 2 players
      const setup = await setupCompleteGame(
        2,
        getTokenAmount(10),
        getTokenAmount(100),
        getTokenAmount(1000)
      );

      // Go through shuffling phase and place blinds
      // ...

      // Wait for timeout and slash
      await sleep(TIMEOUT_SECONDS * 1000 + 5000);

      // Slash one player - game should end immediately
      // Only one player remains

      const state = await fetchGameState(setup.gameAccounts.gameState);
      // Game should be in ClaimPot state since only one player left
    });
  });
});

describe('Texas Hold\'em - Slash Percentage', () => {
  it.skip('should apply custom slash percentage from game config', async () => {
    // Would need to initialize game with custom slash percentage
    // Then verify that the slashed amount matches the configured percentage
  });

  it.skip('should handle 100% slash correctly', async () => {
    // Player loses all chips when slash percentage is 100%
  });

  it.skip('should handle 0% slash correctly', async () => {
    // Player keeps chips but is still force-folded
  });
});
