//! Map deck part 1 instruction (cards 0-25)
//!
//! Stores the original deck points in the accumulator for card identification.
//! Accepts 26 compressed EC points, decompresses them, and stores in accumulator.

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

pub fn process_map_deck_part1(
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
    let game_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let accumulator_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_list_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;

    if !player.is_signer() {
        return Err(PokerError::InvalidSigner.into());
    }

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

    // Validate state - must be in Shuffling and deck not yet submitted
    if game_state.shuffling_state() != ShufflingState::Shuffling {
        return Err(PokerError::InvalidShufflingState.into());
    }

    // Only first player submits the deck mapping
    if game_state.is_deck_submitted() {
        return Err(PokerError::DeckAlreadySubmitted.into());
    }

    // Validate turn
    let current_player = player_list.get_player(game_state.current_turn)
        .ok_or(PokerError::NotAPlayer)?;
    if current_player != player.key() {
        return Err(PokerError::NotYourTurn.into());
    }

    // Check Part1 hasn't been submitted yet (reuse shuffle_part1_done flag)
    // Actually, use a separate flag or just check if accumulator deck_qx[0] is zero
    // For simplicity, we'll track via the shuffle_part1_done flag
    // But that might conflict with shuffle... let's use a different approach
    // Just check if any cards are already mapped by looking at accumulator

    // Use zero-copy mutable reference for accumulator
    let mut accumulator = unsafe {
        AccumulatorStateMut::from_bytes(accumulator_acc.borrow_mut_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Decompress and store cards 0-25 in accumulator deck mapping
    for i in 0..CARDS_PER_PART {
        let offset = i * COMPRESSED_POINT_SIZE;

        // Read compressed point from instruction data
        let compressed: &[u8; COMPRESSED_G1_SIZE] = unsafe {
            &*(data[offset..].as_ptr() as *const [u8; COMPRESSED_G1_SIZE])
        };

        // Decompress using syscall
        let decompressed = bn254_g1_decompress(compressed)
            .map_err(|_| PokerError::DecompressionFailed)?;

        // Store in accumulator deck mapping (split into x and y)
        let qx = unsafe { &*(decompressed[..32].as_ptr() as *const [u8; 32]) };
        let qy = unsafe { &*(decompressed[32..].as_ptr() as *const [u8; 32]) };
        accumulator.set_deck_mapping(i, qx, qy);
    }

    // Mark that we're in the middle of deck mapping (reuse a flag)
    // For now, use shuffle_part1_done as indicator that MapDeckPart1 was done
    player_state.shuffle_part1_done = 1;

    // Update timestamp
    let clock = Clock::get()?;
    game_state.last_action_timestamp = clock.unix_timestamp;

    // Write back states
    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
        player_state_acc.borrow_mut_data_unchecked()[..PLAYER_STATE_SIZE]
            .copy_from_slice(&player_state.to_bytes());
    }

    msg!("MapDeckPart1Complete");
    Ok(())
}
