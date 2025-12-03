//! Map deck part 2 instruction (cards 26-51)
//!
//! Completes the deck mapping started by Part1. Stores remaining 26 cards
//! in the accumulator and sets deck_submitted flag.

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

pub fn process_map_deck_part2(
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

    // Validate state
    if game_state.shuffling_state() != ShufflingState::Shuffling {
        return Err(PokerError::InvalidShufflingState.into());
    }

    // Must not already have deck submitted
    if game_state.is_deck_submitted() {
        return Err(PokerError::DeckAlreadySubmitted.into());
    }

    // Validate turn
    let current_player = player_list.get_player(game_state.current_turn)
        .ok_or(PokerError::NotAPlayer)?;
    if current_player != player.key() {
        return Err(PokerError::NotYourTurn.into());
    }

    // Check Part1 was submitted (using shuffle_part1_done flag)
    if player_state.shuffle_part1_done == 0 {
        return Err(PokerError::Part1NotSubmitted.into());
    }

    // Use zero-copy mutable reference for accumulator
    let mut accumulator = unsafe {
        AccumulatorStateMut::from_bytes(accumulator_acc.borrow_mut_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Decompress and store cards 26-51 in accumulator deck mapping
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

        // Store in accumulator deck mapping (split into x and y)
        let qx = unsafe { &*(decompressed[..32].as_ptr() as *const [u8; 32]) };
        let qy = unsafe { &*(decompressed[32..].as_ptr() as *const [u8; 32]) };
        accumulator.set_deck_mapping(card_index, qx, qy);
    }

    // Reset Part1 flag
    player_state.shuffle_part1_done = 0;

    // Mark deck as submitted - original deck mapping is now complete
    game_state.is_deck_submitted = 1;

    let clock = Clock::get()?;
    game_state.last_action_timestamp = clock.unix_timestamp;

    // Write back states
    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
        player_state_acc.borrow_mut_data_unchecked()[..PLAYER_STATE_SIZE]
            .copy_from_slice(&player_state.to_bytes());
    }

    msg!("MapDeckPart2Complete");
    msg!("DeckMappingComplete");
    Ok(())
}
