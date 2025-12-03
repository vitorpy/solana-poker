# Test Infrastructure Documentation

## Overview

The test suite uses TypeScript + Jest with `solana-test-validator` to run integration tests against the compiled Solana program. The tests are ported from the original Ethereum moonpoker-contracts Hardhat tests.

## Directory Structure

```
tests/
├── integration/
│   ├── game.test.ts       # Full Texas Hold'em game flow
│   └── slash.test.ts      # Slash/timeout penalty tests
├── helpers/
│   ├── validator.ts       # Test validator lifecycle
│   ├── setup.ts           # Account creation, PDA derivation
│   ├── actions.ts         # Game instruction wrappers
│   ├── crypto.ts          # EC cryptography (secp256k1)
│   └── hand-analyzer.ts   # Hand evaluation logic
├── package.json
├── jest.config.js
└── tsconfig.json
```

## Running Tests

```bash
cd tests
npm install
npm test
```

The test suite will automatically:
1. Kill any existing `solana-test-validator` process
2. Start a fresh validator with the poker program loaded
3. Execute all test suites
4. Clean up the validator on completion

## Test Configuration

### Jest Config (`jest.config.js`)

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  testTimeout: 300000,  // 5 minutes for validator startup
  forceExit: true,
  detectOpenHandles: true,
};
```

### TypeScript Config (`tsconfig.json`)

- Target: ES2020
- Module: CommonJS
- Strict mode enabled

## Helper Modules

### validator.ts

Manages the test validator lifecycle:

```typescript
// Start validator with poker program
await startValidator();

// Get connection to localhost:8899
const connection = getConnection();

// Create funded keypair for testing
const payer = await createFundedPayer(lamports);

// Get program ID
const programId = getProgramId();

// Stop validator
await stopValidator();
```

**Implementation Details:**
- Kills existing validator with `pkill -f solana-test-validator`
- Waits 2 seconds for cleanup
- Spawns with `--reset --quiet --bpf-program <id> <path>`
- Waits 10 seconds for readiness
- Uses localhost:8899

### setup.ts

Account creation and game setup utilities:

```typescript
// Initialize a new game
const gameAccounts = await initializeGame(
  authority,
  tokenMint,
  maxPlayers,
  smallBlind,
  minBuyIn
);

// Create a player with tokens
const player = await createPlayer(
  authority,
  gameAccounts,
  tokenMint,
  buyInAmount
);

// Player joins game
await joinGame(player, gameAccounts, buyInAmount);

// Complete game setup (convenience function)
const setup = await setupCompleteGame(
  playerCount,
  smallBlind,
  minBuyIn,
  buyInAmount
);
```

**Exports:**
- PDA derivation functions (`deriveGameConfig`, `deriveGameState`, etc.)
- State fetch functions (`fetchGameState`, `fetchGameConfig`)
- Account creation helpers
- Game setup utilities
- Enums matching Rust definitions

### actions.ts

Wrappers for all 19 game instructions:

| Function | Purpose |
|----------|---------|
| `generateShuffleVector` | Submit player's shuffle vector |
| `shuffleDeck` | Encrypt and shuffle the deck |
| `lockCards` | Apply lock vector to cards |
| `placeBlind` | Post blind bet |
| `placeBlinds` | Post both blinds |
| `draw` | Draw a card |
| `reveal` | Reveal decryption key |
| `drawAndRevealCards` | Draw hole cards for all players |
| `bet` | Place a bet |
| `call` | Call current bet |
| `fold` | Fold hand |
| `check` | Check (pass) |
| `everyoneCalls` | All players call |
| `dealCommunityCards` | Deal community card |
| `dealCommunityCardWithReveals` | Deal + reveal community card |
| `openCommunityCard` | Open community card |
| `openCard` | Open hole card |
| `openCards` | Open multiple cards |
| `submitBestHand` | Submit best 5-card hand |
| `claimPot` | Distribute pot |
| `startNextGame` | Reset for next hand |
| `slash` | Penalize inactive player |
| `leaveGame` | Player leaves |

### crypto.ts

Elliptic curve operations for mental poker:

```typescript
// Generate random 256-bit values
const [privateKey, ...rest] = generateRandomArray();

// Generate work deck from accumulator
const workDeck = generateWorkDeck(accumulator);

// Encrypt deck with private key
const encryptedDeck = encryptWorkDeck(workDeck, privateKey);

// Shuffle deck (Fisher-Yates)
const shuffledDeck = shuffleWorkDeck(encryptedDeck);

// Lock deck with lock vector
const lockedDeck = lockWorkDeck(workDeck, lockVector);

// Decrypt work deck
const decryptedDeck = decryptWorkDeck(lockedDeck, keys);

// Unlock single card
const card = unlockCard(lockedCard, keys);

// Convert point to bytes for instruction data
const bytes = pointToBytes(point);
```

**Cryptographic Notes:**
- Uses secp256k1 curve (same as Ethereum/Bitcoin)
- 256-bit private keys and lock values
- Points serialized as 64 bytes (32 bytes x, 32 bytes y)
- Keccak256 for hashing

### hand-analyzer.ts

Poker hand evaluation matching Rust implementation:

```typescript
// Evaluate a 5-card hand
const [handType, rankedCards] = evaluateHand(cards);

// Select best 5 cards from 7
const bestHand = selectBestHand(holeCards, communityCards);

// Compare two hands
const winner = compareHands(hand1, cards1, hand2, cards2);

// Get hand name
const name = getHandName(HandEnum.Flush); // "Flush"
```

**Hand Rankings (HandEnum):**
0. Royal Flush
1. Straight Flush
2. Four of a Kind
3. Full House
4. Flush
5. Straight
6. Three of a Kind
7. Two Pair
8. Pair
9. High Card

## Test Suites

### game.test.ts - Full Game Flow

Tests a complete Texas Hold'em hand:

1. **Game Setup** - Initialize game, players join
2. **Shuffling Phase** - Generate vectors, shuffle, lock
3. **Betting - Blinds** - Small blind, big blind
4. **Pre-Flop** - Draw hole cards, betting round
5. **Flop** - Deal 3 community cards, betting
6. **Turn** - Deal 4th card, betting
7. **River** - Deal 5th card, betting
8. **Showdown** - Open hole cards, submit best hand
9. **Pot Distribution** - Winner claims pot
10. **Next Game** - Reset for next hand

Also includes:
- Early fold scenario (all but one folds)
- Raise and re-raise betting actions

### slash.test.ts - Timeout Penalties

Tests the slash mechanism for inactive players:

1. **Slash on Timeout**
   - Cannot slash before timeout expires
   - Can slash after timeout (skipped - requires 120s wait)

2. **Slash During Reveal Phase**
   - Slash first non-revealing player
   - Slash last non-revealing player

3. **Slash Chip Distribution**
   - Verify chips distributed to remaining players

4. **Slash Edge Cases**
   - Non-player cannot call slash
   - Cannot slash when game not in progress
   - Game ends when only one player remains

## Writing New Tests

### Basic Test Structure

```typescript
import { startValidator, stopValidator, createFundedPayer } from '../helpers/validator';
import { setupCompleteGame, fetchGameState } from '../helpers/setup';
import { placeBlinds, bet, fold } from '../helpers/actions';

describe('My Feature', () => {
  beforeAll(async () => {
    await startValidator();
  }, 60000);

  afterAll(async () => {
    await stopValidator();
  }, 10000);

  it('should do something', async () => {
    const setup = await setupCompleteGame(2, 10n, 100n, 1000n);

    // Test actions...
    await placeBlinds(setup.players, setup.gameAccounts, 0, 10n);

    // Verify state
    const state = await fetchGameState(setup.gameAccounts.gameState);
    expect(state.pot).toBe(30n);
  });
});
```

### Tips

- Use `setupCompleteGame` for quick game initialization
- Always verify state transitions after actions
- Use appropriate timeouts for slow operations
- Clean up resources in `afterAll`

## Troubleshooting

### Validator won't start

```bash
# Check for orphan processes
ps aux | grep solana-test-validator

# Kill manually if needed
pkill -9 -f solana-test-validator
```

### Tests timing out

- Increase `testTimeout` in jest.config.js
- Check validator logs: `/tmp/solana-test-validator.log`

### Compilation errors

```bash
# Verify types match Rust enums
# Check src/state/enums.rs and update tests/helpers/setup.ts

# Run type check
npx tsc --noEmit
```

### Crypto mismatches

- Ensure using same secp256k1 curve
- Verify point serialization (big-endian, 32 bytes each)
- Check modular arithmetic for large numbers

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @solana/web3.js | ^1.95.4 | Solana RPC client |
| @solana/spl-token | ^0.4.9 | SPL Token operations |
| elliptic | ^6.6.1 | secp256k1 curve |
| bn.js | ^5.2.1 | Big number arithmetic |
| jest | ^29.7.0 | Test framework |
| ts-jest | ^29.2.5 | TypeScript support |
| typescript | ^5.7.2 | TypeScript compiler |
