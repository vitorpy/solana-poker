//! PlayerList account - stores the list of players in seat order
//!
//! Seeds: ["player_list", game_id]

use pinocchio::pubkey::{find_program_address, Pubkey};

use crate::constants::{MAX_PLAYERS, PLAYER_LIST_SEED};

const MAX_PLAYERS_USIZE: usize = MAX_PLAYERS as usize;

/// Size of PlayerList account in bytes
/// bump(1) + game_id(32) + count(1) + players(6*32) + revealed_bitmap(1) = 227 bytes
pub const PLAYER_LIST_SIZE: usize = 1 + 32 + 1 + (MAX_PLAYERS_USIZE * 32) + 1;

/// Player list in seat order
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct PlayerList {
    /// PDA bump seed
    pub bump: u8,
    /// Game ID reference
    pub game_id: [u8; 32],
    /// Number of players
    pub count: u8,
    /// Number of players (alias for count)
    pub player_count: u8,
    /// Players in seat order
    pub players: [Pubkey; MAX_PLAYERS_USIZE],
    /// Bitmap of players who have revealed for current card
    /// Bit i is set if player at index i has revealed
    pub revealed_bitmap: u8,
}

impl PlayerList {
    /// Create a new PlayerList
    pub fn new(bump: u8, game_id: [u8; 32]) -> Self {
        Self {
            bump,
            game_id,
            count: 0,
            player_count: 0,
            players: [[0u8; 32]; MAX_PLAYERS_USIZE],
            revealed_bitmap: 0,
        }
    }

    /// Derive PDA for PlayerList
    pub fn derive_pda(game_id: &[u8; 32], program_id: &Pubkey) -> (Pubkey, u8) {
        find_program_address(&[PLAYER_LIST_SEED, game_id], program_id)
    }

    /// Add a player to the list
    pub fn add_player(&mut self, player: Pubkey) -> Option<u8> {
        if self.count >= MAX_PLAYERS {
            return None;
        }
        let index = self.count;
        self.players[index as usize] = player;
        self.count += 1;
        self.player_count = self.count;
        Some(index)
    }

    /// Get player at index
    pub fn get_player(&self, index: u8) -> Option<&Pubkey> {
        if index >= self.count {
            return None;
        }
        Some(&self.players[index as usize])
    }

    /// Find player by pubkey and return their pubkey
    pub fn find_player(&self, player: &Pubkey) -> Option<u8> {
        self.find_player_index(player)
    }

    /// Find player index by pubkey
    pub fn find_player_index(&self, player: &Pubkey) -> Option<u8> {
        for i in 0..self.count as usize {
            if self.players[i] == *player {
                return Some(i as u8);
            }
        }
        None
    }

    /// Check if player has revealed for current card
    pub fn has_revealed(&self, index: u8) -> bool {
        if index >= MAX_PLAYERS {
            return false;
        }
        (self.revealed_bitmap & (1 << index)) != 0
    }

    /// Mark player as having revealed
    pub fn mark_revealed(&mut self, index: u8) {
        if index < MAX_PLAYERS {
            self.revealed_bitmap |= 1 << index;
        }
    }

    /// Reset revealed bitmap for next card
    pub fn reset_revealed(&mut self) {
        self.revealed_bitmap = 0;
    }

    /// Count revealed players
    pub fn count_revealed(&self) -> u8 {
        self.revealed_bitmap.count_ones() as u8
    }

    /// Serialize to bytes
    pub fn to_bytes(&self) -> [u8; PLAYER_LIST_SIZE] {
        let mut bytes = [0u8; PLAYER_LIST_SIZE];
        let mut offset = 0;

        bytes[offset] = self.bump;
        offset += 1;

        bytes[offset..offset + 32].copy_from_slice(&self.game_id);
        offset += 32;

        bytes[offset] = self.count;
        offset += 1;

        for player in &self.players {
            bytes[offset..offset + 32].copy_from_slice(player);
            offset += 32;
        }

        bytes[offset] = self.revealed_bitmap;

        bytes
    }

    /// Deserialize from bytes
    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        if data.len() < PLAYER_LIST_SIZE {
            return None;
        }

        let mut offset = 0;

        let bump = data[offset];
        offset += 1;

        let mut game_id = [0u8; 32];
        game_id.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let count = data[offset];
        offset += 1;

        let mut players = [[0u8; 32]; MAX_PLAYERS_USIZE];
        for player in &mut players {
            player.copy_from_slice(&data[offset..offset + 32]);
            offset += 32;
        }

        let revealed_bitmap = data[offset];

        Some(Self {
            bump,
            game_id,
            count,
            player_count: count,
            players,
            revealed_bitmap,
        })
    }
}
