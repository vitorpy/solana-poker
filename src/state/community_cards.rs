//! CommunityCards account - stores community cards and their revealed points
//!
//! Seeds: ["community", game_id]

use pinocchio::pubkey::{find_program_address, Pubkey};

use crate::constants::{COMMUNITY_CARDS_SEED, MAX_COMMUNITY_CARDS};
use crate::state::deck_state::EC_POINT_SIZE;

/// Size of CommunityCards account in bytes
/// bump(1) + game_id(32) + card_indices(5) + card_count(1) + opened_cards(5*64) + opened_count(1) = 360 bytes
pub const COMMUNITY_CARDS_SIZE: usize = 1 + 32 + 5 + 1 + (5 * EC_POINT_SIZE) + 1;

/// Community cards state
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct CommunityCards {
    /// PDA bump seed
    pub bump: u8,
    /// Game ID reference
    pub game_id: [u8; 32],
    /// Card indices in the deck (0-51, 255 = not dealt)
    pub card_indices: [u8; MAX_COMMUNITY_CARDS as usize],
    /// Number of cards dealt
    pub card_count: u8,
    /// Opened (decrypted) card EC points
    pub opened_cards: [[u8; EC_POINT_SIZE]; MAX_COMMUNITY_CARDS as usize],
    /// Number of opened cards
    pub opened_count: u8,
}

impl Default for CommunityCards {
    fn default() -> Self {
        Self {
            bump: 0,
            game_id: [0u8; 32],
            card_indices: [255; MAX_COMMUNITY_CARDS as usize],
            card_count: 0,
            opened_cards: [[0u8; EC_POINT_SIZE]; MAX_COMMUNITY_CARDS as usize],
            opened_count: 0,
        }
    }
}

impl CommunityCards {
    /// Create a new CommunityCards
    pub fn new(bump: u8, game_id: [u8; 32]) -> Self {
        Self {
            bump,
            game_id,
            ..Default::default()
        }
    }

    /// Derive PDA for CommunityCards
    pub fn derive_pda(game_id: &[u8; 32], program_id: &Pubkey) -> (Pubkey, u8) {
        find_program_address(&[COMMUNITY_CARDS_SEED, game_id], program_id)
    }

    /// Add a card index to community cards
    pub fn add_card(&mut self, card_index: u8) -> bool {
        if self.card_count >= MAX_COMMUNITY_CARDS {
            return false;
        }
        self.card_indices[self.card_count as usize] = card_index;
        self.card_count += 1;
        true
    }

    /// Add an opened card point
    pub fn add_opened_card(&mut self, qx: &[u8; 32], qy: &[u8; 32]) -> bool {
        if self.opened_count >= MAX_COMMUNITY_CARDS {
            return false;
        }
        let idx = self.opened_count as usize;
        self.opened_cards[idx][..32].copy_from_slice(qx);
        self.opened_cards[idx][32..].copy_from_slice(qy);
        self.opened_count += 1;
        true
    }

    /// Check if an index is a community card
    pub fn is_community_card(&self, index: u8) -> bool {
        for i in 0..self.card_count as usize {
            if self.card_indices[i] == index {
                return true;
            }
        }
        false
    }

    /// Get an opened card's EC point
    pub fn get_opened_card(&self, index: usize) -> Option<([u8; 32], [u8; 32])> {
        if index >= self.opened_count as usize {
            return None;
        }
        let mut qx = [0u8; 32];
        let mut qy = [0u8; 32];
        qx.copy_from_slice(&self.opened_cards[index][..32]);
        qy.copy_from_slice(&self.opened_cards[index][32..]);
        Some((qx, qy))
    }

    /// Reset state for next game
    pub fn reset_for_next_game(&mut self) {
        self.card_indices = [255; MAX_COMMUNITY_CARDS as usize];
        self.card_count = 0;
        self.opened_cards = [[0u8; EC_POINT_SIZE]; MAX_COMMUNITY_CARDS as usize];
        self.opened_count = 0;
    }

    /// Serialize to bytes
    pub fn to_bytes(&self) -> [u8; COMMUNITY_CARDS_SIZE] {
        let mut bytes = [0u8; COMMUNITY_CARDS_SIZE];
        let mut offset = 0;

        bytes[offset] = self.bump;
        offset += 1;

        bytes[offset..offset + 32].copy_from_slice(&self.game_id);
        offset += 32;

        bytes[offset..offset + 5].copy_from_slice(&self.card_indices);
        offset += 5;

        bytes[offset] = self.card_count;
        offset += 1;

        for card in &self.opened_cards {
            bytes[offset..offset + EC_POINT_SIZE].copy_from_slice(card);
            offset += EC_POINT_SIZE;
        }

        bytes[offset] = self.opened_count;

        bytes
    }

    /// Deserialize from bytes
    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        if data.len() < COMMUNITY_CARDS_SIZE {
            return None;
        }

        let mut offset = 0;

        let bump = data[offset];
        offset += 1;

        let mut game_id = [0u8; 32];
        game_id.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut card_indices = [0u8; MAX_COMMUNITY_CARDS as usize];
        card_indices.copy_from_slice(&data[offset..offset + 5]);
        offset += 5;

        let card_count = data[offset];
        offset += 1;

        let mut opened_cards = [[0u8; EC_POINT_SIZE]; MAX_COMMUNITY_CARDS as usize];
        for card in &mut opened_cards {
            card.copy_from_slice(&data[offset..offset + EC_POINT_SIZE]);
            offset += EC_POINT_SIZE;
        }

        let opened_count = data[offset];

        Some(Self {
            bump,
            game_id,
            card_indices,
            card_count,
            opened_cards,
            opened_count,
        })
    }
}
