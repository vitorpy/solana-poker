//! Shuffle deck part 1 instruction (cards 0-25)
//!
//! Accepts 26 compressed EC points, decompresses them using the syscall,
//! and stores them in the deck state. Part 2 must follow to complete shuffle.

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};

use crate::{
    constants::{CARDS_PER_PART, COMPRESSED_POINT_SIZE},
    crypto::bn254::{bn254_g1_decompress, COMPRESSED_G1_SIZE},
    error::PokerError,
    state::*,
};

pub fn process_shuffle_part1(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Data: 26 compressed EC points (26 x 33 bytes = 858 bytes)
    let expected_size = CARDS_PER_PART * COMPRESSED_POINT_SIZE;
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

    let _game_config = unsafe {
        GameConfig::from_bytes(game_config_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let game_state = unsafe {
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

    // Check Part1 hasn't been submitted yet
    if player_state.shuffle_part1_done != 0 {
        return Err(PokerError::Part1AlreadySubmitted.into());
    }

    // Use zero-copy mutable reference for deck state
    let mut deck_state = unsafe {
        DeckStateMut::from_bytes(deck_state_acc.borrow_mut_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Decompress and store cards 0-25
    for i in 0..CARDS_PER_PART {
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
        deck_state.set_card_point(i, qx, qy);
    }

    // Mark Part1 as done
    player_state.shuffle_part1_done = 1;

    // Update timestamp
    let clock = Clock::get()?;
    let mut game_state_mut = game_state;
    game_state_mut.last_action_timestamp = clock.unix_timestamp;

    // Write back states
    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state_mut.to_bytes());
        player_state_acc.borrow_mut_data_unchecked()[..PLAYER_STATE_SIZE]
            .copy_from_slice(&player_state.to_bytes());
    }

    msg!("ShufflePart1Complete");
    Ok(())
}
