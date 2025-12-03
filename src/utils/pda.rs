//! PDA derivation helpers

use pinocchio::pubkey::{find_program_address, create_program_address, Pubkey};

use crate::constants::*;

/// Derive GameConfig PDA
pub fn derive_game_config_pda(game_id: &[u8; 32], program_id: &Pubkey) -> (Pubkey, u8) {
    find_program_address(&[GAME_CONFIG_SEED, game_id], program_id)
}

/// Derive GameState PDA
pub fn derive_game_state_pda(game_id: &[u8; 32], program_id: &Pubkey) -> (Pubkey, u8) {
    find_program_address(&[GAME_STATE_SEED, game_id], program_id)
}

/// Derive PlayerState PDA
pub fn derive_player_state_pda(
    game_id: &[u8; 32],
    player: &Pubkey,
    program_id: &Pubkey,
) -> (Pubkey, u8) {
    find_program_address(&[PLAYER_STATE_SEED, game_id, player], program_id)
}

/// Derive DeckState PDA
pub fn derive_deck_state_pda(game_id: &[u8; 32], program_id: &Pubkey) -> (Pubkey, u8) {
    find_program_address(&[DECK_STATE_SEED, game_id], program_id)
}

/// Derive AccumulatorState PDA
pub fn derive_accumulator_pda(game_id: &[u8; 32], program_id: &Pubkey) -> (Pubkey, u8) {
    find_program_address(&[ACCUMULATOR_SEED, game_id], program_id)
}

/// Derive CommunityCards PDA
pub fn derive_community_cards_pda(game_id: &[u8; 32], program_id: &Pubkey) -> (Pubkey, u8) {
    find_program_address(&[COMMUNITY_CARDS_SEED, game_id], program_id)
}

/// Derive Vault PDA (token account for game)
pub fn derive_vault_pda(game_id: &[u8; 32], program_id: &Pubkey) -> (Pubkey, u8) {
    find_program_address(&[VAULT_SEED, game_id], program_id)
}

/// Derive PlayerList PDA
pub fn derive_player_list_pda(game_id: &[u8; 32], program_id: &Pubkey) -> (Pubkey, u8) {
    find_program_address(&[PLAYER_LIST_SEED, game_id], program_id)
}

/// Verify a PDA matches expected derivation
pub fn verify_pda(
    expected: &Pubkey,
    seeds: &[&[u8]],
    bump: u8,
    program_id: &Pubkey,
) -> bool {
    let bump_slice = [bump];
    let mut all_seeds: Vec<&[u8]> = seeds.to_vec();
    all_seeds.push(&bump_slice);

    match create_program_address(&all_seeds, program_id) {
        Ok(derived) => derived == *expected,
        Err(_) => false,
    }
}
