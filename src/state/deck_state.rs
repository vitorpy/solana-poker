//! DeckState account - stores the shuffled deck (52 EC points)
//!
//! Seeds: ["deck", game_id]
//!
//! This module provides both owned (`DeckState`) and zero-copy reference
//! (`DeckStateRef`, `DeckStateMut`) types for accessing account data.
//! The zero-copy types are preferred in instruction handlers to minimize stack usage.

use pinocchio::pubkey::{find_program_address, Pubkey};

use crate::constants::{DECK_SIZE, DECK_STATE_SEED};

/// Zero pubkey constant for unowned cards
const ZERO_PUBKEY: Pubkey = [0u8; 32];

/// Size of one EC point (uncompressed: x and y coordinates, 32 bytes each)
pub const EC_POINT_SIZE: usize = 64;

/// Size of DeckState account in bytes
/// bump(1) + game_id(32) + work_deck(52*64) + card_owners(52*32) = 3361 bytes
pub const DECK_STATE_SIZE: usize = 1 + 32 + (DECK_SIZE * EC_POINT_SIZE) + (DECK_SIZE * 32);

// Layout offsets for zero-copy access
const BUMP_OFFSET: usize = 0;
const GAME_ID_OFFSET: usize = 1;
const WORK_DECK_OFFSET: usize = 33; // 1 + 32
const CARD_OWNERS_OFFSET: usize = WORK_DECK_OFFSET + (DECK_SIZE * EC_POINT_SIZE); // 33 + 3328 = 3361

/// Deck state account containing the shuffled deck
#[repr(C)]
#[derive(Clone, Debug)]
pub struct DeckState {
    /// PDA bump seed
    pub bump: u8,
    /// Game ID reference
    pub game_id: [u8; 32],
    /// Work deck: 52 EC points (uncompressed: 64 bytes each)
    /// Each point is stored as [x: 32 bytes, y: 32 bytes]
    pub work_deck: [[u8; EC_POINT_SIZE]; DECK_SIZE],
    /// Card ownership: which player owns each card position
    /// Pubkey::default() means no owner
    pub card_owners: [Pubkey; DECK_SIZE],
}

impl Default for DeckState {
    fn default() -> Self {
        Self {
            bump: 0,
            game_id: [0u8; 32],
            work_deck: [[0u8; EC_POINT_SIZE]; DECK_SIZE],
            card_owners: [ZERO_PUBKEY; DECK_SIZE],
        }
    }
}

impl DeckState {
    /// Create a new DeckState
    pub fn new(bump: u8, game_id: [u8; 32]) -> Self {
        Self {
            bump,
            game_id,
            ..Default::default()
        }
    }

    /// Derive PDA for DeckState
    pub fn derive_pda(game_id: &[u8; 32], program_id: &Pubkey) -> (Pubkey, u8) {
        find_program_address(&[DECK_STATE_SEED, game_id], program_id)
    }

    /// Get a card's EC point coordinates
    pub fn get_card_point(&self, index: usize) -> Option<([u8; 32], [u8; 32])> {
        if index >= DECK_SIZE {
            return None;
        }
        let point = &self.work_deck[index];
        let mut x = [0u8; 32];
        let mut y = [0u8; 32];
        x.copy_from_slice(&point[..32]);
        y.copy_from_slice(&point[32..]);
        Some((x, y))
    }

    /// Set a card's EC point coordinates
    pub fn set_card_point(&mut self, index: usize, x: &[u8; 32], y: &[u8; 32]) {
        if index < DECK_SIZE {
            self.work_deck[index][..32].copy_from_slice(x);
            self.work_deck[index][32..].copy_from_slice(y);
        }
    }

    /// Get card owner
    pub fn get_card_owner(&self, index: usize) -> Option<&Pubkey> {
        if index >= DECK_SIZE {
            return None;
        }
        Some(&self.card_owners[index])
    }

    /// Set card owner
    pub fn set_card_owner(&mut self, index: usize, owner: Pubkey) {
        if index < DECK_SIZE {
            self.card_owners[index] = owner;
        }
    }

    /// Clear card owner
    pub fn clear_card_owner(&mut self, index: usize) {
        if index < DECK_SIZE {
            self.card_owners[index] = ZERO_PUBKEY;
        }
    }

    /// Reset state for next game
    pub fn reset_for_next_game(&mut self) {
        self.work_deck = [[0u8; EC_POINT_SIZE]; DECK_SIZE];
        self.card_owners = [ZERO_PUBKEY; DECK_SIZE];
    }

    /// Serialize to bytes (for account data)
    pub fn serialize_into(&self, data: &mut [u8]) {
        if data.len() < DECK_STATE_SIZE {
            return;
        }

        let mut offset = 0;

        data[offset] = self.bump;
        offset += 1;

        data[offset..offset + 32].copy_from_slice(&self.game_id);
        offset += 32;

        for point in &self.work_deck {
            data[offset..offset + EC_POINT_SIZE].copy_from_slice(point);
            offset += EC_POINT_SIZE;
        }

        for owner in &self.card_owners {
            data[offset..offset + 32].copy_from_slice(owner);
            offset += 32;
        }
    }

    // NOTE: deserialize removed - use DeckStateRef/DeckStateMut for zero-copy access
}

// =============================================================================
// Zero-Copy Reference Types (Stack-Efficient)
// =============================================================================

/// Zero-copy immutable view into DeckState account data.
/// Stack cost: ~16 bytes (just the slice reference)
#[derive(Clone, Copy)]
pub struct DeckStateRef<'a> {
    data: &'a [u8],
}

impl<'a> DeckStateRef<'a> {
    /// Create a zero-copy reference from account data bytes
    #[inline]
    pub fn from_bytes(data: &'a [u8]) -> Option<Self> {
        if data.len() < DECK_STATE_SIZE {
            return None;
        }
        Some(Self { data })
    }

    /// Get the PDA bump seed
    #[inline]
    pub fn bump(&self) -> u8 {
        self.data[BUMP_OFFSET]
    }

    /// Get the game ID as a reference
    #[inline]
    pub fn game_id(&self) -> &[u8; 32] {
        unsafe { &*(self.data[GAME_ID_OFFSET..].as_ptr() as *const [u8; 32]) }
    }

    /// Get a card's full EC point (64 bytes: x || y)
    #[inline]
    pub fn get_card_point_bytes(&self, index: usize) -> &[u8; EC_POINT_SIZE] {
        debug_assert!(index < DECK_SIZE);
        let offset = WORK_DECK_OFFSET + index * EC_POINT_SIZE;
        unsafe { &*(self.data[offset..].as_ptr() as *const [u8; EC_POINT_SIZE]) }
    }

    /// Get a card's EC point as (x, y) coordinate references
    #[inline]
    pub fn get_card_point(&self, index: usize) -> (&[u8; 32], &[u8; 32]) {
        debug_assert!(index < DECK_SIZE);
        let offset = WORK_DECK_OFFSET + index * EC_POINT_SIZE;
        let x = unsafe { &*(self.data[offset..].as_ptr() as *const [u8; 32]) };
        let y = unsafe { &*(self.data[offset + 32..].as_ptr() as *const [u8; 32]) };
        (x, y)
    }

    /// Get card owner pubkey at index
    #[inline]
    pub fn get_card_owner(&self, index: usize) -> &Pubkey {
        debug_assert!(index < DECK_SIZE);
        let offset = CARD_OWNERS_OFFSET + index * 32;
        unsafe { &*(self.data[offset..].as_ptr() as *const Pubkey) }
    }

    /// Check if a card has an owner
    #[inline]
    pub fn card_has_owner(&self, index: usize) -> bool {
        self.get_card_owner(index) != &ZERO_PUBKEY
    }
}

/// Zero-copy mutable view into DeckState account data.
/// Stack cost: ~16 bytes (just the slice reference)
pub struct DeckStateMut<'a> {
    data: &'a mut [u8],
}

impl<'a> DeckStateMut<'a> {
    /// Create a zero-copy mutable reference from account data bytes
    #[inline]
    pub fn from_bytes(data: &'a mut [u8]) -> Option<Self> {
        if data.len() < DECK_STATE_SIZE {
            return None;
        }
        Some(Self { data })
    }

    /// Get the PDA bump seed
    #[inline]
    pub fn bump(&self) -> u8 {
        self.data[BUMP_OFFSET]
    }

    /// Set the bump seed
    #[inline]
    pub fn set_bump(&mut self, bump: u8) {
        self.data[BUMP_OFFSET] = bump;
    }

    /// Get the game ID as a reference
    #[inline]
    pub fn game_id(&self) -> &[u8; 32] {
        unsafe { &*(self.data[GAME_ID_OFFSET..].as_ptr() as *const [u8; 32]) }
    }

    /// Set the game ID
    #[inline]
    pub fn set_game_id(&mut self, game_id: &[u8; 32]) {
        self.data[GAME_ID_OFFSET..GAME_ID_OFFSET + 32].copy_from_slice(game_id);
    }

    /// Get a card's full EC point (64 bytes: x || y)
    #[inline]
    pub fn get_card_point_bytes(&self, index: usize) -> &[u8; EC_POINT_SIZE] {
        debug_assert!(index < DECK_SIZE);
        let offset = WORK_DECK_OFFSET + index * EC_POINT_SIZE;
        unsafe { &*(self.data[offset..].as_ptr() as *const [u8; EC_POINT_SIZE]) }
    }

    /// Get a card's EC point as (x, y) coordinate references
    #[inline]
    pub fn get_card_point(&self, index: usize) -> (&[u8; 32], &[u8; 32]) {
        debug_assert!(index < DECK_SIZE);
        let offset = WORK_DECK_OFFSET + index * EC_POINT_SIZE;
        let x = unsafe { &*(self.data[offset..].as_ptr() as *const [u8; 32]) };
        let y = unsafe { &*(self.data[offset + 32..].as_ptr() as *const [u8; 32]) };
        (x, y)
    }

    /// Set a card's EC point from (x, y) coordinates
    #[inline]
    pub fn set_card_point(&mut self, index: usize, x: &[u8; 32], y: &[u8; 32]) {
        debug_assert!(index < DECK_SIZE);
        let offset = WORK_DECK_OFFSET + index * EC_POINT_SIZE;
        self.data[offset..offset + 32].copy_from_slice(x);
        self.data[offset + 32..offset + 64].copy_from_slice(y);
    }

    /// Set a card's EC point from 64-byte array
    #[inline]
    pub fn set_card_point_bytes(&mut self, index: usize, point: &[u8; EC_POINT_SIZE]) {
        debug_assert!(index < DECK_SIZE);
        let offset = WORK_DECK_OFFSET + index * EC_POINT_SIZE;
        self.data[offset..offset + EC_POINT_SIZE].copy_from_slice(point);
    }

    /// Get card owner pubkey at index
    #[inline]
    pub fn get_card_owner(&self, index: usize) -> &Pubkey {
        debug_assert!(index < DECK_SIZE);
        let offset = CARD_OWNERS_OFFSET + index * 32;
        unsafe { &*(self.data[offset..].as_ptr() as *const Pubkey) }
    }

    /// Set card owner at index
    #[inline]
    pub fn set_card_owner(&mut self, index: usize, owner: &Pubkey) {
        debug_assert!(index < DECK_SIZE);
        let offset = CARD_OWNERS_OFFSET + index * 32;
        self.data[offset..offset + 32].copy_from_slice(owner);
    }

    /// Clear card owner at index (set to zero pubkey)
    #[inline]
    pub fn clear_card_owner(&mut self, index: usize) {
        self.set_card_owner(index, &ZERO_PUBKEY);
    }

    /// Check if a card has an owner
    #[inline]
    pub fn card_has_owner(&self, index: usize) -> bool {
        self.get_card_owner(index) != &ZERO_PUBKEY
    }

    /// Reset state for next game (zeros work_deck and card_owners)
    pub fn reset_for_next_game(&mut self) {
        // Zero work_deck
        let work_deck_start = WORK_DECK_OFFSET;
        let work_deck_end = WORK_DECK_OFFSET + (DECK_SIZE * EC_POINT_SIZE);
        self.data[work_deck_start..work_deck_end].fill(0);

        // Zero card_owners
        let owners_start = CARD_OWNERS_OFFSET;
        let owners_end = CARD_OWNERS_OFFSET + (DECK_SIZE * 32);
        self.data[owners_start..owners_end].fill(0);
    }

    /// Initialize the state with bump and game_id (other fields stay zeroed)
    #[inline]
    pub fn initialize(&mut self, bump: u8, game_id: &[u8; 32]) {
        self.set_bump(bump);
        self.set_game_id(game_id);
    }
}
