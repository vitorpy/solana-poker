# Solana Poker - Claude Code Instructions

## Project Overview

Mental Poker implementation on Solana using the Pinocchio framework. Ported from the Ethereum moonpoker-contracts project.

## Key Technologies

- **Rust** - Solana program (smart contract)
- **Pinocchio** - Lightweight Solana framework (alternative to Anchor)
- **secp256k1** - Elliptic curve cryptography for card encryption
- **TypeScript/Jest** - Integration tests

## Project Structure

```
solana-poker/
├── src/
│   ├── lib.rs              # Program entry point
│   ├── processor.rs        # Instruction dispatcher
│   ├── error.rs            # Custom errors
│   ├── constants.rs        # Seeds, sizes, timeouts
│   ├── entrypoint.rs       # Solana entrypoint
│   ├── instructions/       # 19 instruction handlers
│   ├── state/              # Account structures + enums
│   ├── crypto/             # secp256k1, commitments
│   ├── poker/              # Card logic, hand ranking
│   └── utils/              # PDA derivation, validation
├── tests/                  # TypeScript integration tests
│   ├── helpers/            # Test utilities
│   └── integration/        # Test suites
└── docs/                   # Documentation
```

## Building

```bash
# Build the Solana program
cargo build-sbf

# The compiled program will be at:
# target/deploy/solana_poker.so
```

## Testing

```bash
# Run integration tests (requires solana-test-validator)
cd tests
npm install
npm test
```

## Mental Poker Protocol

The game follows these phases:

1. **Setup** - Players join with buy-in, commit to shuffle seeds
2. **Generate** - Players reveal shuffle vectors, accumulator built
3. **Shuffle** - Each player encrypts and shuffles the deck
4. **Lock** - Each player applies their lock vector to cards
5. **Drawing** - Players draw cards, others reveal decryption keys
6. **Betting** - Standard Texas Hold'em betting rounds
7. **Showdown** - Players open hole cards, submit best hand
8. **Resolution** - Winner determined, pot distributed

## Important Enums (src/state/enums.rs)

When working with game state, use these exact enum values:

```rust
GamePhase: Shuffling=0, Drawing=1, Betting=2, Revealing=3, Finished=4
ShufflingState: Generating=0, Shuffling=1, Locking=2
TexasHoldEmState: NotStarted=0, Setup=1, Drawing=2, CommunityCardsAwaiting=3,
                  Betting=4, Revealing=5, SubmitBest=6, ClaimPot=7, StartNext=8, Finished=9
BettingRoundState: Blinds=0, PreFlop=1, PostFlop=2, PostTurn=3, Showdown=4
```

## Instructions (src/instructions/)

| Instruction | File | Purpose |
|-------------|------|---------|
| InitializeGame | initialize_game.rs | Create game accounts |
| JoinGame | join_game.rs | Player joins with buy-in |
| Generate | generate.rs | Submit shuffle vector |
| Shuffle | shuffle.rs | Encrypt and shuffle deck |
| Lock | lock.rs | Apply lock vector to cards |
| MapDeck | map_deck.rs | Map deck indices |
| Draw | draw.rs | Player draws a card |
| Reveal | reveal.rs | Reveal decryption key for card |
| PlaceBlind | place_blind.rs | Post small/big blind |
| Bet | bet.rs | Place a bet |
| Fold | fold.rs | Fold hand |
| DealCommunity | deal_community.rs | Deal community card |
| OpenCommunityCard | open_community_card.rs | Reveal community card |
| Open | open.rs | Open hole card for showdown |
| SubmitBestHand | submit_best_hand.rs | Submit best 5-card hand |
| ClaimPot | claim_pot.rs | Distribute pot to winner(s) |
| StartNextGame | start_next_game.rs | Reset for next hand |
| Slash | slash.rs | Penalize inactive player |
| Leave | leave.rs | Player leaves game |

## PDA Seeds (src/constants.rs)

- `GAME_CONFIG_SEED` - Game configuration
- `GAME_STATE_SEED` - Current game state
- `PLAYER_STATE_SEED` - Per-player state
- `PLAYER_LIST_SEED` - List of players
- `DECK_STATE_SEED` - Deck encryption state
- `ACCUMULATOR_SEED` - Shuffle accumulator
- `COMMUNITY_CARDS_SEED` - Community cards

## Code Style

- Use Pinocchio's `AccountInfo` and `ProgramResult`
- Keep instruction handlers focused on single responsibility
- Validate all inputs at instruction boundaries
- Use descriptive error variants in `error.rs`

## Testing Guidelines

- Tests use `solana-test-validator` with `--bpf-program` preload
- Crypto operations use `elliptic` library (same secp256k1 curve)
- Test timeout is 300 seconds (validator startup)
- Always verify state transitions after actions

## Common Tasks

### Adding a new instruction

1. Create handler in `src/instructions/new_instruction.rs`
2. Add to `src/instructions/mod.rs`
3. Add discriminator to `src/processor.rs`
4. Add wrapper to `tests/helpers/actions.ts`
5. Add test cases

### Modifying state

1. Update struct in `src/state/`
2. Update corresponding helpers in `tests/helpers/setup.ts`
3. Verify serialization matches between Rust and TypeScript

## References

- Original Ethereum implementation: `moonpoker-contracts/`
- Test pattern reference: `onchain-verifier/tests/`
- Pinocchio docs: https://github.com/febo/pinocchio
