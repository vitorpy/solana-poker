# Solana Poker Architecture

## Overview

Solana Poker is a decentralized Texas Hold'em implementation using the Mental Poker protocol. Players can play poker without trusting a central dealer - the deck is shuffled and encrypted collaboratively by all players.

## Mental Poker Protocol

### The Problem

In online poker, a central server deals cards. Players must trust this server isn't cheating. Mental Poker solves this by having players collaboratively shuffle and encrypt the deck so no single party knows the card order until cards are revealed.

### The Solution

1. **Collaborative Shuffle** - Each player encrypts and shuffles the deck
2. **Lock Vectors** - Each player applies a "lock" to each card
3. **Selective Reveal** - To see a card, all players (except the drawer) reveal their lock for that position

### Protocol Phases

```
┌─────────────────────────────────────────────────────────────┐
│                       SETUP PHASE                           │
├─────────────────────────────────────────────────────────────┤
│  1. Game initialized with config (max players, blinds)      │
│  2. Players join with buy-in, commit to shuffle seed        │
│  3. When full, transition to shuffling                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    SHUFFLING PHASE                          │
├─────────────────────────────────────────────────────────────┤
│  1. GENERATE: Each player reveals shuffle vector            │
│     - Vectors combined into accumulator (deck seed)         │
│                                                             │
│  2. SHUFFLE: Each player in turn:                           │
│     - Encrypts deck with private key                        │
│     - Shuffles card order                                   │
│     - Submits shuffled deck                                 │
│                                                             │
│  3. LOCK: Each player applies lock vector                   │
│     - 52 random values, one per card position               │
│     - All locks applied = cards are "locked"                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    DRAWING PHASE                            │
├─────────────────────────────────────────────────────────────┤
│  For each hole card (2 per player):                         │
│  1. Player calls DRAW for next card position                │
│  2. Other players call REVEAL with their lock key           │
│  3. Drawing player can now decrypt their card               │
│  4. Only drawer knows card value (private information)      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    BETTING ROUNDS                           │
├─────────────────────────────────────────────────────────────┤
│  Pre-flop:                                                  │
│  1. Small blind posts                                       │
│  2. Big blind posts                                         │
│  3. Action around table (bet/call/fold/raise)               │
│                                                             │
│  Flop (3 cards):                                            │
│  1. Dealer deals community card                             │
│  2. All players reveal locks                                │
│  3. Betting round                                           │
│                                                             │
│  Turn (4th card): Same as flop                              │
│  River (5th card): Same as flop                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      SHOWDOWN                               │
├─────────────────────────────────────────────────────────────┤
│  1. Remaining players OPEN their hole cards                 │
│     - Reveal lock keys for own cards                        │
│     - Anyone can now verify card values                     │
│                                                             │
│  2. Each player SUBMIT_BEST_HAND                            │
│     - Select best 5 cards from 7 available                  │
│     - Hand evaluated on-chain                               │
│                                                             │
│  3. Winner CLAIM_POT                                        │
│     - Pot distributed to winner(s)                          │
│     - Ties split pot                                        │
└─────────────────────────────────────────────────────────────┘
```

## Cryptography

### Elliptic Curve Operations

Uses secp256k1 curve (same as Bitcoin/Ethereum):
- Generator point G
- Curve order n
- Private keys: random 256-bit integers
- Public points: scalar multiplication kG

### Card Representation

Each card is an EC point derived from the accumulator:
```
accumulator[i] = sum of all player shuffle vectors at position i
card_point[i] = accumulator[i] * G
```

### Encryption

To encrypt card at position i with private key k:
```
encrypted[i] = card_point[i] + k * G
```

To decrypt:
```
decrypted[i] = encrypted[i] - k * G
```

### Locking

Lock vector L contains 52 random values. To lock:
```
locked[i] = card_point[i] + L[i] * G
```

To unlock (reveal key):
```
unlocked[i] = locked[i] - L[i] * G
```

When all players reveal their lock keys for position i:
```
final[i] = locked[i] - sum(all L[i]) * G = original card_point[i]
```

## Account Structure

### Program Derived Addresses (PDAs)

All game state stored in PDAs derived from game ID:

```
GameConfig     [GAME_CONFIG_SEED, game_id]        - Static config
GameState      [GAME_STATE_SEED, game_id]         - Current state
PlayerState    [PLAYER_STATE_SEED, game_id, key]  - Per-player
PlayerList     [PLAYER_LIST_SEED, game_id]        - Player roster
DeckState      [DECK_STATE_SEED, game_id]         - Deck encryption
Accumulator    [ACCUMULATOR_SEED, game_id]        - Shuffle seed
CommunityCards [COMMUNITY_CARDS_SEED, game_id]    - Board cards
```

### GameConfig

```rust
pub struct GameConfig {
    pub authority: Pubkey,        // Game creator
    pub token_mint: Pubkey,       // SPL token for chips
    pub max_players: u8,          // 2-10
    pub current_players: u8,
    pub small_blind: u64,
    pub min_buy_in: u64,
    pub is_accepting_players: bool,
}
```

### GameState

```rust
pub struct GameState {
    pub game_phase: GamePhase,
    pub shuffling_state: ShufflingState,
    pub texas_state: TexasHoldEmState,
    pub betting_round_state: BettingRoundState,
    pub current_turn: u8,
    pub dealer_index: u8,
    pub pot: u64,
    pub current_bet: u64,
    pub last_action_time: i64,
    // ... more fields
}
```

### PlayerState

```rust
pub struct PlayerState {
    pub player: Pubkey,
    pub chips: u64,
    pub current_bet: u64,
    pub is_active: bool,
    pub has_folded: bool,
    pub has_acted: bool,
    pub commitment: [u8; 32],     // Shuffle commitment
    pub lock_hash: [u8; 32],      // Lock vector hash
    // ... more fields
}
```

## Instruction Flow

### Initialization

```
InitializeGame
    └── Creates: GameConfig, GameState, PlayerList, DeckState,
                 Accumulator, CommunityCards, Vault
```

### Player Joins

```
JoinGame
    ├── Creates: PlayerState
    ├── Transfers: buy-in tokens to vault
    └── Updates: PlayerList, GameConfig.current_players
```

### Shuffling

```
Generate (each player)
    └── Updates: Accumulator with shuffle vector

Shuffle (each player in turn)
    └── Updates: DeckState with encrypted/shuffled deck

Lock (each player)
    └── Updates: DeckState with locked deck
```

### Betting

```
PlaceBlind
    ├── Updates: PlayerState.chips, current_bet
    └── Updates: GameState.pot

Bet/Call/Fold
    ├── Updates: PlayerState
    └── Updates: GameState (pot, current_bet, turn)
```

### Resolution

```
SubmitBestHand
    └── Updates: PlayerState with hand evaluation

ClaimPot
    ├── Determines winner(s)
    ├── Transfers: tokens from vault
    └── Updates: GameState
```

## Error Handling

All errors defined in `src/error.rs`:

| Error | Code | Description |
|-------|------|-------------|
| InvalidInstruction | 0 | Unknown instruction discriminator |
| NotAuthority | 1 | Signer not game authority |
| GameFull | 2 | Max players reached |
| InsufficientFunds | 3 | Not enough chips |
| NotYourTurn | 4 | Wrong player acting |
| InvalidPhase | 5 | Wrong game phase |
| TimeoutNotReached | 6 | Cannot slash yet |
| ... | ... | ... |

## Security Considerations

### Timeout Protection

Players must act within `TIMEOUT_SECONDS` (default: 120). If a player times out:
- Any player can call `Slash`
- Offender loses percentage of chips
- Chips distributed to other players
- Game continues without offender

### Commitment Scheme

Players commit to shuffle vectors before revealing:
1. `JoinGame` includes hash(shuffle_vector)
2. `Generate` must match commitment
3. Prevents players from choosing vectors based on others

### Verification

All cryptographic proofs verified on-chain:
- Lock key reveals verified against commitments
- Card decryptions verified mathematically
- Hand evaluations deterministic and verifiable

## Performance Notes

- Account sizes pre-calculated (see `constants.rs`)
- Deck operations use efficient point arithmetic
- State transitions validated at boundaries
- Rent-exempt accounts persist across transactions
