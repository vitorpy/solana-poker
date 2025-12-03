//! PlayerState account - stores per-player state
//!
//! Seeds: ["player", game_id, player_pubkey]

use pinocchio::pubkey::{find_program_address, Pubkey};

use crate::constants::PLAYER_STATE_SEED;
use crate::poker::HandEnum;

/// Size of PlayerState account in bytes
/// bump(1) + game_id(32) + player(32) + seat_index(1) + chips(8) + current_bet(8) +
/// commitment(32) + has_committed(1) + hole_cards(2) + hole_cards_count(1) +
/// revealed_cards(128) + revealed_cards_count(1) + is_folded(1) + has_revealed_current(1) +
/// submitted_hand(1) + hand_cards(5) + hand_rank(1) + shuffle_part1_done(1) + lock_part1_done(1) = 258 bytes
pub const PLAYER_STATE_SIZE: usize = 258;

/// Per-player state account
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct PlayerState {
    /// PDA bump seed
    pub bump: u8,
    /// Game ID reference
    pub game_id: [u8; 32],
    /// Player's public key
    pub player: Pubkey,
    /// Seat position (0 to max_players-1)
    pub seat_index: u8,

    // Chips
    /// Current chip count
    pub chips: u64,
    /// Current bet in this round
    pub current_bet: u64,

    // Commitment for shuffling
    /// Keccak256 hash of shuffle vector
    pub commitment: [u8; 32],
    /// Whether player has committed
    pub has_committed: u8,

    // Cards (indices into deck, 255 = not dealt)
    /// Player's two hole cards (indices)
    pub hole_cards: [u8; 2],
    /// Number of hole cards dealt
    pub hole_cards_count: u8,

    // Revealed cards (EC points after decryption)
    /// Revealed hole card points (2 x 64 bytes)
    pub revealed_cards: [([u8; 32], [u8; 32]); 2],
    /// Number of revealed cards
    pub revealed_cards_count: u8,

    // Game state
    /// Whether player has folded
    pub is_folded: u8,
    /// Whether player has revealed for current card
    pub has_revealed_current: u8,

    // Hand submission
    /// Submitted hand type (HandEnum)
    pub submitted_hand: u8,
    /// Card values for tiebreaker
    pub hand_cards: [i8; 5],
    /// Computed rank among players
    pub hand_rank: u8,

    // Split transaction tracking
    /// Whether shuffle Part1 has been submitted (0 = no, 1 = yes)
    pub shuffle_part1_done: u8,
    /// Whether lock Part1 has been submitted (0 = no, 1 = yes)
    pub lock_part1_done: u8,
}

impl PlayerState {
    /// Create a new PlayerState
    pub fn new(
        bump: u8,
        game_id: [u8; 32],
        player: Pubkey,
        seat_index: u8,
        chips: u64,
        commitment: [u8; 32],
    ) -> Self {
        Self {
            bump,
            game_id,
            player,
            seat_index,
            chips,
            current_bet: 0,
            commitment,
            has_committed: 1,
            hole_cards: [255, 255],
            hole_cards_count: 0,
            revealed_cards: [([0u8; 32], [0u8; 32]); 2],
            revealed_cards_count: 0,
            is_folded: 0,
            has_revealed_current: 0,
            submitted_hand: HandEnum::HighCard as u8,
            hand_cards: [-1; 5],
            hand_rank: 0,
            shuffle_part1_done: 0,
            lock_part1_done: 0,
        }
    }

    /// Derive PDA for PlayerState
    pub fn derive_pda(game_id: &[u8; 32], player: &Pubkey, program_id: &Pubkey) -> (Pubkey, u8) {
        find_program_address(&[PLAYER_STATE_SEED, game_id, player], program_id)
    }

    pub fn is_folded(&self) -> bool {
        self.is_folded != 0
    }

    pub fn has_committed(&self) -> bool {
        self.has_committed != 0
    }

    pub fn has_revealed_current(&self) -> bool {
        self.has_revealed_current != 0
    }

    /// Reset state for next game
    pub fn reset_for_next_game(&mut self) {
        self.current_bet = 0;
        self.commitment = [0u8; 32];
        self.has_committed = 0;
        self.hole_cards = [255, 255];
        self.hole_cards_count = 0;
        self.revealed_cards = [([0u8; 32], [0u8; 32]); 2];
        self.revealed_cards_count = 0;
        self.is_folded = 0;
        self.has_revealed_current = 0;
        self.submitted_hand = HandEnum::HighCard as u8;
        self.hand_cards = [-1; 5];
        self.hand_rank = 0;
        self.shuffle_part1_done = 0;
        self.lock_part1_done = 0;
    }

    /// Serialize to bytes
    pub fn to_bytes(&self) -> [u8; PLAYER_STATE_SIZE] {
        let mut bytes = [0u8; PLAYER_STATE_SIZE];
        let mut offset = 0;

        bytes[offset] = self.bump;
        offset += 1;

        bytes[offset..offset + 32].copy_from_slice(&self.game_id);
        offset += 32;

        bytes[offset..offset + 32].copy_from_slice(&self.player);
        offset += 32;

        bytes[offset] = self.seat_index;
        offset += 1;

        bytes[offset..offset + 8].copy_from_slice(&self.chips.to_le_bytes());
        offset += 8;

        bytes[offset..offset + 8].copy_from_slice(&self.current_bet.to_le_bytes());
        offset += 8;

        bytes[offset..offset + 32].copy_from_slice(&self.commitment);
        offset += 32;

        bytes[offset] = self.has_committed;
        offset += 1;

        bytes[offset..offset + 2].copy_from_slice(&self.hole_cards);
        offset += 2;

        bytes[offset] = self.hole_cards_count;
        offset += 1;

        for (x, y) in &self.revealed_cards {
            bytes[offset..offset + 32].copy_from_slice(x);
            offset += 32;
            bytes[offset..offset + 32].copy_from_slice(y);
            offset += 32;
        }

        bytes[offset] = self.revealed_cards_count;
        offset += 1;

        bytes[offset] = self.is_folded;
        offset += 1;

        bytes[offset] = self.has_revealed_current;
        offset += 1;

        bytes[offset] = self.submitted_hand;
        offset += 1;

        for i in 0..5 {
            bytes[offset + i] = self.hand_cards[i] as u8;
        }
        offset += 5;

        bytes[offset] = self.hand_rank;
        offset += 1;

        bytes[offset] = self.shuffle_part1_done;
        offset += 1;

        bytes[offset] = self.lock_part1_done;

        bytes
    }

    /// Deserialize from bytes
    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        if data.len() < PLAYER_STATE_SIZE {
            return None;
        }

        let mut offset = 0;

        let bump = data[offset];
        offset += 1;

        let mut game_id = [0u8; 32];
        game_id.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut player = [0u8; 32];
        player.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let seat_index = data[offset];
        offset += 1;

        let chips = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        let current_bet = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        let mut commitment = [0u8; 32];
        commitment.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let has_committed = data[offset];
        offset += 1;

        let mut hole_cards = [0u8; 2];
        hole_cards.copy_from_slice(&data[offset..offset + 2]);
        offset += 2;

        let hole_cards_count = data[offset];
        offset += 1;

        let mut revealed_cards = [([0u8; 32], [0u8; 32]); 2];
        for (x, y) in &mut revealed_cards {
            x.copy_from_slice(&data[offset..offset + 32]);
            offset += 32;
            y.copy_from_slice(&data[offset..offset + 32]);
            offset += 32;
        }

        let revealed_cards_count = data[offset];
        offset += 1;

        let is_folded = data[offset];
        offset += 1;

        let has_revealed_current = data[offset];
        offset += 1;

        let submitted_hand = data[offset];
        offset += 1;

        let mut hand_cards = [0i8; 5];
        for i in 0..5 {
            hand_cards[i] = data[offset + i] as i8;
        }
        offset += 5;

        let hand_rank = data[offset];
        offset += 1;

        let shuffle_part1_done = data[offset];
        offset += 1;

        let lock_part1_done = data[offset];

        Some(Self {
            bump,
            game_id,
            player,
            seat_index,
            chips,
            current_bet,
            commitment,
            has_committed,
            hole_cards,
            hole_cards_count,
            revealed_cards,
            revealed_cards_count,
            is_folded,
            has_revealed_current,
            submitted_hand,
            hand_cards,
            hand_rank,
            shuffle_part1_done,
            lock_part1_done,
        })
    }
}
