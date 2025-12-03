//! Instruction handlers

pub mod initialize_game;
pub mod join_game;
pub mod generate;
pub mod map_deck;
pub mod map_deck_part1;
pub mod map_deck_part2;
pub mod shuffle;
pub mod shuffle_part1;
pub mod shuffle_part2;
pub mod lock;
pub mod lock_part1;
pub mod lock_part2;
pub mod draw;
pub mod reveal;
pub mod place_blind;
pub mod bet;
pub mod fold;
pub mod deal_community;
pub mod open_community_card;
pub mod open;
pub mod submit_best_hand;
pub mod claim_pot;
pub mod start_next_game;
pub mod leave;
pub mod slash;
pub mod close_game;
pub mod test_compression;

pub use initialize_game::*;
pub use join_game::*;
pub use generate::*;
pub use map_deck::*;
pub use map_deck_part1::*;
pub use map_deck_part2::*;
pub use shuffle::*;
pub use shuffle_part1::*;
pub use shuffle_part2::*;
pub use lock::*;
pub use lock_part1::*;
pub use lock_part2::*;
pub use draw::*;
pub use reveal::*;
pub use place_blind::*;
pub use bet::*;
pub use fold::*;
pub use deal_community::*;
pub use open_community_card::*;
pub use open::*;
pub use submit_best_hand::*;
pub use claim_pot::*;
pub use start_next_game::*;
pub use leave::*;
pub use slash::*;
pub use close_game::*;
pub use test_compression::*;

/// Helper to get next account from iterator
pub fn next_account_info<'a>(
    iter: &mut core::slice::Iter<'a, pinocchio::account_info::AccountInfo>,
) -> Result<&'a pinocchio::account_info::AccountInfo, pinocchio::program_error::ProgramError> {
    iter.next().ok_or(pinocchio::program_error::ProgramError::NotEnoughAccountKeys)
}
