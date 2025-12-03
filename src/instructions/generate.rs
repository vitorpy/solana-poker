//! Generate shuffle vector instruction
//!
//! Uses seed-based derivation to reduce transaction size from 1664 bytes to 32 bytes.
//! Player submits a seed, on-chain derives v[i] = keccak256(seed || i) for all 52 cards.
//! Commitment verification: keccak256(seed) must match the commitment stored at join time.

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};

use crate::{constants::*, crypto::*, error::PokerError, state::*};

pub fn process_generate(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Data: 32-byte seed (reduced from 1664 bytes)
    if data.len() < 32 {
        return Err(ProgramError::InvalidInstructionData);
    }

    // Extract seed from instruction data
    let seed: &[u8; 32] = unsafe { &*(data.as_ptr() as *const [u8; 32]) };

    let mut iter = accounts.iter();
    let player = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_config_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let accumulator_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_list_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;

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

    let player_state = unsafe {
        PlayerState::from_bytes(player_state_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let player_list = unsafe {
        PlayerList::from_bytes(player_list_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Validate state
    if game_state.shuffling_state() != ShufflingState::Generating {
        return Err(PokerError::InvalidShufflingState.into());
    }

    // Validate turn
    let current_player = player_list.get_player(game_state.current_turn)
        .ok_or(PokerError::NotAPlayer)?;
    if current_player != player.key() {
        return Err(PokerError::NotYourTurn.into());
    }

    // Verify commitment: keccak256(seed) must match stored commitment
    // This preserves the hiding property - commitment hides the seed until reveal
    let computed_commitment = keccak256(seed);
    if computed_commitment != player_state.commitment {
        return Err(PokerError::InvalidCommitment.into());
    }

    // Use zero-copy mutable reference instead of deserializing onto stack
    let mut accumulator = unsafe {
        AccumulatorStateMut::from_bytes(accumulator_acc.borrow_mut_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Derive and accumulate all 52 values on-chain
    // v[i] = keccak256(seed || i) - PRF derivation
    // This replaces sending 1664 bytes with 32 bytes + 52 keccak256 calls (~5300 CU)
    for i in 0..DECK_SIZE {
        let mut preimage = [0u8; 33];
        preimage[0..32].copy_from_slice(seed);
        preimage[32] = i as u8;
        let derived_value = keccak256(&preimage);
        accumulator.add_to_accumulator(i, &derived_value);
    }

    game_state.active_player_count += 1;

    let clock = Clock::get()?;
    game_state.last_action_timestamp = clock.unix_timestamp;

    // Check if all players have generated
    if game_state.active_player_count >= game_config.max_players {
        game_state.shuffling_state = ShufflingState::Shuffling as u8;
        game_state.active_player_count = 0;
        game_state.current_turn = (game_config.dealer_index + 3) % game_config.max_players;
        msg!("ShufflingStateChanged: Shuffling");
    } else {
        // Next turn
        game_state.current_turn = (game_state.current_turn + 1) % game_config.max_players;
    }

    // Write back game_state only
    // Note: accumulator writes go directly to account via zero-copy
    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
    }

    msg!("AccumulatorUpdated");
    Ok(())
}
