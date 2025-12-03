//! AccumulatorState account - stores the shuffle accumulator and original deck mapping
//!
//! Seeds: ["accumulator", game_id]
//!
//! This module provides both owned (`AccumulatorState`) and zero-copy reference
//! (`AccumulatorStateRef`, `AccumulatorStateMut`) types for accessing account data.
//! The zero-copy types are preferred in instruction handlers to minimize stack usage.

use pinocchio::pubkey::{find_program_address, Pubkey};

use crate::constants::{ACCUMULATOR_SEED, DECK_SIZE};

// Layout offsets for zero-copy access
const BUMP_OFFSET: usize = 0;
const GAME_ID_OFFSET: usize = 1;
const ACCUMULATOR_OFFSET: usize = 33; // 1 + 32
const DECK_QX_OFFSET: usize = ACCUMULATOR_OFFSET + (DECK_SIZE * 32); // 33 + 1664 = 1697
const DECK_QY_OFFSET: usize = DECK_QX_OFFSET + (DECK_SIZE * 32); // 1697 + 1664 = 3361

/// Size of AccumulatorState account in bytes
/// bump(1) + game_id(32) + accumulator(52*32) + deck_qx(52*32) + deck_qy(52*32) = 5025 bytes
pub const ACCUMULATOR_STATE_SIZE: usize = 1 + 32 + (DECK_SIZE * 32) + (DECK_SIZE * 32) + (DECK_SIZE * 32);

/// Accumulator state for shuffle randomness and deck mapping
#[repr(C)]
#[derive(Clone, Debug)]
pub struct AccumulatorState {
    /// PDA bump seed
    pub bump: u8,
    /// Game ID reference
    pub game_id: [u8; 32],
    /// Randomness accumulator (52 x 32-byte values)
    /// Sum of all players' shuffle vectors
    pub accumulator: [[u8; 32]; DECK_SIZE],
    /// Original deck X coordinates (for card identification)
    pub deck_qx: [[u8; 32]; DECK_SIZE],
    /// Original deck Y coordinates (for card identification)
    pub deck_qy: [[u8; 32]; DECK_SIZE],
}

impl Default for AccumulatorState {
    fn default() -> Self {
        Self {
            bump: 0,
            game_id: [0u8; 32],
            accumulator: [[0u8; 32]; DECK_SIZE],
            deck_qx: [[0u8; 32]; DECK_SIZE],
            deck_qy: [[0u8; 32]; DECK_SIZE],
        }
    }
}

impl AccumulatorState {
    /// Create a new AccumulatorState
    pub fn new(bump: u8, game_id: [u8; 32]) -> Self {
        Self {
            bump,
            game_id,
            ..Default::default()
        }
    }

    /// Derive PDA for AccumulatorState
    pub fn derive_pda(game_id: &[u8; 32], program_id: &Pubkey) -> (Pubkey, u8) {
        find_program_address(&[ACCUMULATOR_SEED, game_id], program_id)
    }

    /// Add a value to the accumulator at index
    /// Performs modular addition in the field
    pub fn add_to_accumulator(&mut self, index: usize, value: &[u8; 32]) {
        if index >= DECK_SIZE {
            return;
        }

        // Simple 256-bit addition with overflow handling
        let mut carry: u16 = 0;
        for i in (0..32).rev() {
            let sum = self.accumulator[index][i] as u16 + value[i] as u16 + carry;
            self.accumulator[index][i] = sum as u8;
            carry = sum >> 8;
        }
    }

    /// Set the deck mapping (qx, qy) for a card
    pub fn set_deck_mapping(&mut self, index: usize, qx: &[u8; 32], qy: &[u8; 32]) {
        if index < DECK_SIZE {
            self.deck_qx[index].copy_from_slice(qx);
            self.deck_qy[index].copy_from_slice(qy);
        }
    }

    /// Get the deck mapping for a card
    pub fn get_deck_mapping(&self, index: usize) -> Option<([u8; 32], [u8; 32])> {
        if index >= DECK_SIZE {
            return None;
        }
        Some((self.deck_qx[index], self.deck_qy[index]))
    }

    /// Find card ID by EC point coordinates
    /// Returns the card index (0-51) if found, None otherwise
    pub fn find_card_by_point(&self, qx: &[u8; 32], qy: &[u8; 32]) -> Option<i8> {
        for i in 0..DECK_SIZE {
            if self.deck_qx[i] == *qx && self.deck_qy[i] == *qy {
                return Some(i as i8);
            }
        }
        None
    }

    /// Reset state for next game
    pub fn reset_for_next_game(&mut self) {
        self.accumulator = [[0u8; 32]; DECK_SIZE];
        // Keep deck_qx and deck_qy as they can be reused
    }

    /// Serialize to bytes
    pub fn serialize_into(&self, data: &mut [u8]) {
        if data.len() < ACCUMULATOR_STATE_SIZE {
            return;
        }

        let mut offset = 0;

        data[offset] = self.bump;
        offset += 1;

        data[offset..offset + 32].copy_from_slice(&self.game_id);
        offset += 32;

        for acc in &self.accumulator {
            data[offset..offset + 32].copy_from_slice(acc);
            offset += 32;
        }

        for qx in &self.deck_qx {
            data[offset..offset + 32].copy_from_slice(qx);
            offset += 32;
        }

        for qy in &self.deck_qy {
            data[offset..offset + 32].copy_from_slice(qy);
            offset += 32;
        }
    }

    // NOTE: deserialize removed - use AccumulatorStateRef/AccumulatorStateMut for zero-copy access
}

// =============================================================================
// Zero-Copy Reference Types (Stack-Efficient)
// =============================================================================

/// Zero-copy immutable view into AccumulatorState account data.
/// Stack cost: ~16 bytes (just the slice reference)
#[derive(Clone, Copy)]
pub struct AccumulatorStateRef<'a> {
    data: &'a [u8],
}

impl<'a> AccumulatorStateRef<'a> {
    /// Create a zero-copy reference from account data bytes
    #[inline]
    pub fn from_bytes(data: &'a [u8]) -> Option<Self> {
        if data.len() < ACCUMULATOR_STATE_SIZE {
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

    /// Get accumulator value at index (0-51)
    #[inline]
    pub fn get_accumulator(&self, index: usize) -> &[u8; 32] {
        debug_assert!(index < DECK_SIZE);
        let offset = ACCUMULATOR_OFFSET + index * 32;
        unsafe { &*(self.data[offset..].as_ptr() as *const [u8; 32]) }
    }

    /// Get deck_qx value at index (0-51)
    #[inline]
    pub fn get_deck_qx(&self, index: usize) -> &[u8; 32] {
        debug_assert!(index < DECK_SIZE);
        let offset = DECK_QX_OFFSET + index * 32;
        unsafe { &*(self.data[offset..].as_ptr() as *const [u8; 32]) }
    }

    /// Get deck_qy value at index (0-51)
    #[inline]
    pub fn get_deck_qy(&self, index: usize) -> &[u8; 32] {
        debug_assert!(index < DECK_SIZE);
        let offset = DECK_QY_OFFSET + index * 32;
        unsafe { &*(self.data[offset..].as_ptr() as *const [u8; 32]) }
    }

    /// Get deck mapping (qx, qy) for a card - returns references
    #[inline]
    pub fn get_deck_mapping(&self, index: usize) -> (&[u8; 32], &[u8; 32]) {
        (self.get_deck_qx(index), self.get_deck_qy(index))
    }

    /// Find card ID by EC point coordinates
    /// Returns the card index (0-51) if found, None otherwise
    pub fn find_card_by_point(&self, qx: &[u8; 32], qy: &[u8; 32]) -> Option<i8> {
        for i in 0..DECK_SIZE {
            if self.get_deck_qx(i) == qx && self.get_deck_qy(i) == qy {
                return Some(i as i8);
            }
        }
        None
    }
}

/// Zero-copy mutable view into AccumulatorState account data.
/// Stack cost: ~16 bytes (just the slice reference)
pub struct AccumulatorStateMut<'a> {
    data: &'a mut [u8],
}

impl<'a> AccumulatorStateMut<'a> {
    /// Create a zero-copy mutable reference from account data bytes
    #[inline]
    pub fn from_bytes(data: &'a mut [u8]) -> Option<Self> {
        if data.len() < ACCUMULATOR_STATE_SIZE {
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

    /// Get accumulator value at index (0-51)
    #[inline]
    pub fn get_accumulator(&self, index: usize) -> &[u8; 32] {
        debug_assert!(index < DECK_SIZE);
        let offset = ACCUMULATOR_OFFSET + index * 32;
        unsafe { &*(self.data[offset..].as_ptr() as *const [u8; 32]) }
    }

    /// Set accumulator value at index
    #[inline]
    pub fn set_accumulator(&mut self, index: usize, value: &[u8; 32]) {
        debug_assert!(index < DECK_SIZE);
        let offset = ACCUMULATOR_OFFSET + index * 32;
        self.data[offset..offset + 32].copy_from_slice(value);
    }

    /// Add a value to the accumulator at index (modular addition)
    pub fn add_to_accumulator(&mut self, index: usize, value: &[u8; 32]) {
        debug_assert!(index < DECK_SIZE);
        let offset = ACCUMULATOR_OFFSET + index * 32;

        // Simple 256-bit addition with overflow handling
        let mut carry: u16 = 0;
        for i in (0..32).rev() {
            let sum = self.data[offset + i] as u16 + value[i] as u16 + carry;
            self.data[offset + i] = sum as u8;
            carry = sum >> 8;
        }
    }

    /// Get deck_qx value at index (0-51)
    #[inline]
    pub fn get_deck_qx(&self, index: usize) -> &[u8; 32] {
        debug_assert!(index < DECK_SIZE);
        let offset = DECK_QX_OFFSET + index * 32;
        unsafe { &*(self.data[offset..].as_ptr() as *const [u8; 32]) }
    }

    /// Set deck_qx value at index
    #[inline]
    pub fn set_deck_qx(&mut self, index: usize, value: &[u8; 32]) {
        debug_assert!(index < DECK_SIZE);
        let offset = DECK_QX_OFFSET + index * 32;
        self.data[offset..offset + 32].copy_from_slice(value);
    }

    /// Get deck_qy value at index (0-51)
    #[inline]
    pub fn get_deck_qy(&self, index: usize) -> &[u8; 32] {
        debug_assert!(index < DECK_SIZE);
        let offset = DECK_QY_OFFSET + index * 32;
        unsafe { &*(self.data[offset..].as_ptr() as *const [u8; 32]) }
    }

    /// Set deck_qy value at index
    #[inline]
    pub fn set_deck_qy(&mut self, index: usize, value: &[u8; 32]) {
        debug_assert!(index < DECK_SIZE);
        let offset = DECK_QY_OFFSET + index * 32;
        self.data[offset..offset + 32].copy_from_slice(value);
    }

    /// Set the deck mapping (qx, qy) for a card
    #[inline]
    pub fn set_deck_mapping(&mut self, index: usize, qx: &[u8; 32], qy: &[u8; 32]) {
        self.set_deck_qx(index, qx);
        self.set_deck_qy(index, qy);
    }

    /// Get deck mapping (qx, qy) for a card - returns references
    #[inline]
    pub fn get_deck_mapping(&self, index: usize) -> (&[u8; 32], &[u8; 32]) {
        (self.get_deck_qx(index), self.get_deck_qy(index))
    }

    /// Find card ID by EC point coordinates
    pub fn find_card_by_point(&self, qx: &[u8; 32], qy: &[u8; 32]) -> Option<i8> {
        for i in 0..DECK_SIZE {
            if self.get_deck_qx(i) == qx && self.get_deck_qy(i) == qy {
                return Some(i as i8);
            }
        }
        None
    }

    /// Reset accumulator values for next game (zeros them out)
    pub fn reset_accumulator(&mut self) {
        let start = ACCUMULATOR_OFFSET;
        let end = ACCUMULATOR_OFFSET + (DECK_SIZE * 32);
        self.data[start..end].fill(0);
    }

    /// Initialize the state with bump and game_id (other fields stay zeroed)
    #[inline]
    pub fn initialize(&mut self, bump: u8, game_id: &[u8; 32]) {
        self.set_bump(bump);
        self.set_game_id(game_id);
    }
}
