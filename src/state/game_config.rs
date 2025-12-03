//! GameConfig account - stores global game configuration
//!
//! Seeds: ["game_config", game_id]

use pinocchio::pubkey::{find_program_address, Pubkey};

use crate::constants::{GAME_CONFIG_SEED, DEFAULT_TIMEOUT_SECONDS, DEFAULT_SLASH_PERCENTAGE};

/// Size of GameConfig account in bytes
/// bump(1) + game_id(32) + authority(32) + token_mint(32) + max_players(1) + current_players(1)
/// + small_blind(8) + min_buy_in(8) + dealer_index(1) + is_accepting_players(1) + created_at(8)
/// + timeout_seconds(4) + slash_percentage(1) + game_number(4) = 134 bytes
pub const GAME_CONFIG_SIZE: usize = 1 + 32 + 32 + 32 + 1 + 1 + 8 + 8 + 1 + 1 + 8 + 4 + 1 + 4;

/// Game configuration account
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct GameConfig {
    /// PDA bump seed
    pub bump: u8,
    /// Unique game identifier
    pub game_id: [u8; 32],
    /// Game creator/authority
    pub authority: Pubkey,
    /// SPL token mint for chips
    pub token_mint: Pubkey,
    /// Maximum players (2-6)
    pub max_players: u8,
    /// Current number of players
    pub current_players: u8,
    /// Small blind amount
    pub small_blind: u64,
    /// Minimum buy-in amount
    pub min_buy_in: u64,
    /// Current dealer position index
    pub dealer_index: u8,
    /// Whether the game is accepting new players
    pub is_accepting_players: u8, // bool as u8
    /// Creation timestamp
    pub created_at: i64,
    /// Timeout in seconds for actions
    pub timeout_seconds: u32,
    /// Slash percentage (0-100) for timeout penalties
    pub slash_percentage: u8,
    /// Game number (increments each round)
    pub game_number: u32,
}

impl GameConfig {
    /// Create a new GameConfig
    pub fn new(
        bump: u8,
        game_id: [u8; 32],
        authority: Pubkey,
        token_mint: Pubkey,
        max_players: u8,
        small_blind: u64,
        min_buy_in: u64,
        created_at: i64,
    ) -> Self {
        Self {
            bump,
            game_id,
            authority,
            token_mint,
            max_players,
            current_players: 0,
            small_blind,
            min_buy_in,
            dealer_index: 0,
            is_accepting_players: 1, // true
            created_at,
            timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
            slash_percentage: DEFAULT_SLASH_PERCENTAGE,
            game_number: 0,
        }
    }

    /// Derive PDA for GameConfig
    pub fn derive_pda(game_id: &[u8; 32], program_id: &Pubkey) -> (Pubkey, u8) {
        find_program_address(&[GAME_CONFIG_SEED, game_id], program_id)
    }

    /// Check if accepting players
    pub fn is_accepting_players(&self) -> bool {
        self.is_accepting_players != 0 && self.current_players < self.max_players
    }

    /// Set accepting players flag
    pub fn set_accepting_players(&mut self, accepting: bool) {
        self.is_accepting_players = if accepting { 1 } else { 0 };
    }

    /// Serialize to bytes
    pub fn to_bytes(&self) -> [u8; GAME_CONFIG_SIZE] {
        let mut bytes = [0u8; GAME_CONFIG_SIZE];
        let mut offset = 0;

        bytes[offset] = self.bump;
        offset += 1;

        bytes[offset..offset + 32].copy_from_slice(&self.game_id);
        offset += 32;

        bytes[offset..offset + 32].copy_from_slice(&self.authority);
        offset += 32;

        bytes[offset..offset + 32].copy_from_slice(&self.token_mint);
        offset += 32;

        bytes[offset] = self.max_players;
        offset += 1;

        bytes[offset] = self.current_players;
        offset += 1;

        bytes[offset..offset + 8].copy_from_slice(&self.small_blind.to_le_bytes());
        offset += 8;

        bytes[offset..offset + 8].copy_from_slice(&self.min_buy_in.to_le_bytes());
        offset += 8;

        bytes[offset] = self.dealer_index;
        offset += 1;

        bytes[offset] = self.is_accepting_players;
        offset += 1;

        bytes[offset..offset + 8].copy_from_slice(&self.created_at.to_le_bytes());
        offset += 8;

        bytes[offset..offset + 4].copy_from_slice(&self.timeout_seconds.to_le_bytes());
        offset += 4;

        bytes[offset] = self.slash_percentage;
        offset += 1;

        bytes[offset..offset + 4].copy_from_slice(&self.game_number.to_le_bytes());

        bytes
    }

    /// Deserialize from bytes
    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        if data.len() < GAME_CONFIG_SIZE {
            return None;
        }

        let mut offset = 0;

        let bump = data[offset];
        offset += 1;

        let mut game_id = [0u8; 32];
        game_id.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut authority = [0u8; 32];
        authority.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let mut token_mint = [0u8; 32];
        token_mint.copy_from_slice(&data[offset..offset + 32]);
        offset += 32;

        let max_players = data[offset];
        offset += 1;

        let current_players = data[offset];
        offset += 1;

        let small_blind = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        let min_buy_in = u64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        let dealer_index = data[offset];
        offset += 1;

        let is_accepting_players = data[offset];
        offset += 1;

        let created_at = i64::from_le_bytes(data[offset..offset + 8].try_into().ok()?);
        offset += 8;

        let timeout_seconds = u32::from_le_bytes(data[offset..offset + 4].try_into().ok()?);
        offset += 4;

        let slash_percentage = data[offset];
        offset += 1;

        let game_number = u32::from_le_bytes(data[offset..offset + 4].try_into().ok()?);

        Some(Self {
            bump,
            game_id,
            authority,
            token_mint,
            max_players,
            current_players,
            small_blind,
            min_buy_in,
            dealer_index,
            is_accepting_players,
            created_at,
            timeout_seconds,
            slash_percentage,
            game_number,
        })
    }
}
