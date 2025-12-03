//! Shuffle deck part 2 instruction (cards 26-51)
//!
//! Completes the shuffle operation started by Part1. Accepts remaining 26
//! compressed EC points, decompresses them, and advances game state.

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};

use crate::{
    constants::{CARDS_PER_PART, COMPRESSED_POINT_SIZE, DECK_SIZE},
    crypto::bn254::{bn254_g1_decompress, COMPRESSED_G1_SIZE},
    error::PokerError,
    state::*,
};

pub fn process_shuffle_part2(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Data: 26 compressed EC points (26 x 33 bytes = 858 bytes)
    let expected_size = (DECK_SIZE - CARDS_PER_PART) * COMPRESSED_POINT_SIZE;
    if data.len() < expected_size {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut iter = accounts.iter();
    let player = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_config_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let deck_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_list_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;

    if !player.is_signer() {
        return Err(PokerError::InvalidSigner.into());
    }

    let game_config = unsafe {
        GameConfig::from_bytes(game_config_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let mut game_state = unsafe {
        GameState::from_bytes(game_state_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let player_list = unsafe {
        PlayerList::from_bytes(player_list_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let mut player_state = unsafe {
        PlayerState::from_bytes(player_state_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Validate state
    if game_state.shuffling_state() != ShufflingState::Shuffling {
        return Err(PokerError::InvalidShufflingState.into());
    }

    // Note: No deck_submitted check - first shuffle establishes the deck

    // Validate turn
    let current_player = player_list.get_player(game_state.current_turn)
        .ok_or(PokerError::NotAPlayer)?;
    if current_player != player.key() {
        return Err(PokerError::NotYourTurn.into());
    }

    // Check Part1 was submitted
    if player_state.shuffle_part1_done == 0 {
        return Err(PokerError::Part1NotSubmitted.into());
    }

    // Use zero-copy mutable reference for deck state
    let mut deck_state = unsafe {
        DeckStateMut::from_bytes(deck_state_acc.borrow_mut_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Decompress and store cards 26-51
    let remaining_cards = DECK_SIZE - CARDS_PER_PART;
    for i in 0..remaining_cards {
        let card_index = CARDS_PER_PART + i;
        let offset = i * COMPRESSED_POINT_SIZE;

        // Read compressed point from instruction data
        let compressed: &[u8; COMPRESSED_G1_SIZE] = unsafe {
            &*(data[offset..].as_ptr() as *const [u8; COMPRESSED_G1_SIZE])
        };

        // Decompress using syscall
        let decompressed = bn254_g1_decompress(compressed)
            .map_err(|_| PokerError::DecompressionFailed)?;

        // Store in deck state (split into x and y)
        let qx = unsafe { &*(decompressed[..32].as_ptr() as *const [u8; 32]) };
        let qy = unsafe { &*(decompressed[32..].as_ptr() as *const [u8; 32]) };
        deck_state.set_card_point(card_index, qx, qy);
    }

    // Reset Part1 flag for next round or next player
    player_state.shuffle_part1_done = 0;

    // First player's shuffle establishes the deck
    if !game_state.is_deck_submitted() {
        game_state.is_deck_submitted = 1;
    }

    // Increment player count
    game_state.active_player_count += 1;

    let clock = Clock::get()?;
    game_state.last_action_timestamp = clock.unix_timestamp;

    // Check if all players have shuffled
    if game_state.active_player_count >= game_config.max_players {
        game_state.shuffling_state = ShufflingState::Locking as u8;
        game_state.active_player_count = 0;
        game_state.current_turn = (game_config.dealer_index + 3) % game_config.max_players;
        msg!("ShufflingStateChanged: Locking");
    } else {
        game_state.current_turn = (game_state.current_turn + 1) % game_config.max_players;
    }

    // Write back states
    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
        player_state_acc.borrow_mut_data_unchecked()[..PLAYER_STATE_SIZE]
            .copy_from_slice(&player_state.to_bytes());
    }

    msg!("ShufflePart2Complete");
    msg!("WorkDeckUpdate");
    Ok(())
}
