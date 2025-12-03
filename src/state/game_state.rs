//! GameState account - stores the current game state machine
//!
//! Seeds: ["game_state", game_id]

use pinocchio::pubkey::{find_program_address, Pubkey};

use crate::constants::{GAME_STATE_SEED, DECK_SIZE};
use crate::state::enums::*;

/// Size of GameState account in bytes
pub const GAME_STATE_SIZE: usize = 1 + 32 + 6 + 8 + 1 + 1 + 1 + 1 + 1 + 8 + 8 + 32 + 1 + 1 + 1 + 1 + 8 + 8 + 1; // ~125 bytes

/// Game state machine account
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct GameState {
    /// PDA bump seed
    pub bump: u8,
    /// Game ID reference
    pub game_id: [u8; 32],

    // State machine values (stored as u8)
    /// Current game phase
    pub game_phase: u8,
    /// Shuffling sub-state
    pub shuffling_state: u8,
    /// Drawing sub-state
    pub drawing_state: u8,
    /// Texas Hold'em state
    pub texas_state: u8,
    /// Betting round state
    pub betting_round_state: u8,
    /// Community cards state
    pub community_cards_state: u8,

    // Turn tracking
    /// Current turn index into player list
    pub current_turn: u8,
    /// Number of players who completed current action
    pub active_player_count: u8,
    /// Number of folded players
    pub num_folded_players: u8,
    /// Total cards drawn so far
    pub cards_drawn: u8,
    /// Player cards opened in showdown
    pub player_cards_opened: u8,
    /// Number of players who submitted their hand
    pub num_submitted_hands: u8,

    // Betting
    /// Current pot amount
    pub pot: u64,
    /// Current pot size (alias for pot)
    pub pot_size: u64,
    /// Current call amount
    pub current_call_amount: u64,
    /// Current bet amount
    pub current_bet: u64,
    /// Last raise amount
    pub last_raise: u64,
    /// Last player to call (for round end detection)
    pub last_to_call: Pubkey,
    /// Everyone is all-in flag
    pub is_everybody_all_in: u8,
    /// Pot has been claimed
    pub pot_claimed: u8,

    // Deck tracking
    /// Card index currently being revealed
    pub card_to_reveal: u8,
    /// Cards left in deck
    pub cards_left_in_deck: u8,
    /// Whether deck has been submitted
    pub is_deck_submitted: u8,

    // Timing
    /// Last action timestamp for slash mechanism
    pub last_action_timestamp: i64,
}

impl GameState {
    /// Create a new GameState
    pub fn new(bump: u8, game_id: [u8; 32], timestamp: i64) -> Self {
        Self {
            bump,
            game_id,
            game_phase: GamePhase::Shuffling as u8,
            shuffling_state: ShufflingState::Committing as u8,
            drawing_state: DrawingState::Picking as u8,
            texas_state: TexasHoldEmState::Betting as u8,
            betting_round_state: BettingRoundState::Blinds as u8,
            community_cards_state: CommunityCardsState::Opening as u8,
            current_turn: 0,
            active_player_count: 0,
            num_folded_players: 0,
            cards_drawn: 0,
            player_cards_opened: 0,
            num_submitted_hands: 0,
            pot: 0,
            pot_size: 0,
            current_call_amount: 0,
            current_bet: 0,
            last_raise: 0,
            last_to_call: [0u8; 32],
            is_everybody_all_in: 0,
            pot_claimed: 0,
            card_to_reveal: 0,
            cards_left_in_deck: DECK_SIZE as u8,
            is_deck_submitted: 0,
            last_action_timestamp: timestamp,
        }
    }

    /// Derive PDA for GameState
    pub fn derive_pda(game_id: &[u8; 32], program_id: &Pubkey) -> (Pubkey, u8) {
        find_program_address(&[GAME_STATE_SEED, game_id], program_id)
    }

    // Getters for typed enums
    pub fn game_phase(&self) -> GamePhase {
        GamePhase::from(self.game_phase)
    }

    pub fn shuffling_state(&self) -> ShufflingState {
        ShufflingState::from(self.shuffling_state)
    }

    pub fn drawing_state(&self) -> DrawingState {
        DrawingState::from(self.drawing_state)
    }

    pub fn texas_state(&self) -> TexasHoldEmState {
        TexasHoldEmState::from(self.texas_state)
    }

    pub fn betting_round_state(&self) -> BettingRoundState {
        BettingRoundState::from(self.betting_round_state)
    }

    pub fn community_cards_state(&self) -> CommunityCardsState {
        CommunityCardsState::from(self.community_cards_state)
    }

    pub fn is_deck_submitted(&self) -> bool {
        self.is_deck_submitted != 0
    }

    pub fn is_everybody_all_in(&self) -> bool {
        self.is_everybody_all_in != 0
    }

    /// Serialize to bytes
    pub fn to_bytes(&self) -> [u8; GAME_STATE_SIZE] {
        let mut bytes = [0u8; GAME_STATE_SIZE];
        let mut offset = 0;

        bytes[offset] = self.bump;
        offset += 1;

        bytes[offset..offset + 32].copy_from_slice(&self.game_id);
        offset += 32;

        bytes[offset] = self.game_phase;
        offset += 1;
        bytes[offset] = self.shuffling_state;
        offset += 1;
        bytes[offset] = self.drawing_state;
        offset += 1;
        bytes[offset] = self.texas_state;
        offset += 1;
        bytes[offset] = self.betting_round_state;
        offset += 1;
        bytes[offset] = self.community_cards_state;
        offset += 1;

        bytes[offset] = self.current_turn;
        offset += 1;
        bytes[offset] = self.active_player_count;
        offset += 1;
        bytes[offset] = self.num_folded_players;
        offset += 1;
        bytes[offset] = self.cards_drawn;
        offset += 1;
        bytes[offset] = self.player_cards_opened;
        offset += 1;
        bytes[offset] = self.num_submitted_hands;
        offset += 1;

        bytes[offset..offset + 8].copy_from_slice(&self.pot.to_le_bytes());
        offset += 8;
        bytes[offset..offset + 8].copy_from_slice(&self.current_call_amount.to_le_bytes());
        offset += 8;
        bytes[offset..offset + 32].copy_from_slice(&self.last_to_call);
        offset += 32;
        bytes[offset] = self.is_everybody_all_in;
        offset += 1;
        bytes[offset] = self.pot_claimed;
        offset += 1;

        bytes[offset] = self.card_to_reveal;
        offset += 1;
        bytes[offset] = self.cards_left_in_deck;
        offset += 1;
        bytes[offset] = self.is_deck_submitted;
        offset += 1;

        bytes[offset..offset + 8].copy_from_slice(&self.last_action_timestamp.to_le_bytes());

        bytes
    }

    /// Deserialize from bytes
    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        if data.len() < GAME_STATE_SIZE {
            return None;
        }

        let mut offset = 0;

        let bump = data[offset];
        offset += 1;

        let mut game_id = [0u8; 32];
        game_id.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let game_phase = data[offset];
        offset += 1;
        let shuffling_state = data[offset];
        offset += 1;
        let drawing_state = data[offset];
        offset += 1;
        let texas_state = data[offset];
        offset += 1;
        let betting_round_state = data[offset];
        offset += 1;
        let community_cards_state = data[offset];
        offset += 1;

        let current_turn = data[offset];
        offset += 1;
        let active_player_count = data[offset];
        offset += 1;
        let num_folded_players = data[offset];
        offset += 1;
        let cards_drawn = data[offset];
        offset += 1;
        let player_cards_opened = data[offset];
        offset += 1;
        let num_submitted_hands = data[offset];
        offset += 1;

        let pot = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;
        let current_call_amount = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;
        let mut last_to_call = [0u8; 32];
        last_to_call.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;
        let is_everybody_all_in = data[offset];
        offset += 1;
        let pot_claimed = data[offset];
        offset += 1;

        let card_to_reveal = data[offset];
        offset += 1;
        let cards_left_in_deck = data[offset];
        offset += 1;
        let is_deck_submitted = data[offset];
        offset += 1;

        let last_action_timestamp = i64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);

        Some(Self {
            bump,
            game_id,
            game_phase,
            shuffling_state,
            drawing_state,
            texas_state,
            betting_round_state,
            community_cards_state,
            current_turn,
            active_player_count,
            num_folded_players,
            cards_drawn,
            player_cards_opened,
            num_submitted_hands,
            pot,
            pot_size: pot,
            current_call_amount,
            current_bet: current_call_amount,
            last_raise: 0,
            last_to_call,
            is_everybody_all_in,
            pot_claimed,
            card_to_reveal,
            cards_left_in_deck,
            is_deck_submitted,
            last_action_timestamp,
        })
    }
}
