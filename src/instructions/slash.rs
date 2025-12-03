//! Slash instruction - penalize inactive players for timeout

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};
use pinocchio_token::instructions::Transfer;

use crate::{error::PokerError, state::*};

pub fn process_slash(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let mut iter = accounts.iter();
    let caller = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_config_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let offender_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_list_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let chip_vault_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let slash_recipient_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let _token_program = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;

    if !caller.is_signer() {
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

    let mut offender_state = unsafe {
        PlayerState::from_bytes(offender_state_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let player_list = unsafe {
        PlayerList::from_bytes(player_list_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Validate caller is a player in the game
    let _caller_idx = player_list.find_player(caller.key())
        .ok_or(PokerError::NotAPlayer)?;

    // Validate game is in progress
    if game_state.game_phase() == GamePhase::WaitingForPlayers
        || game_state.game_phase() == GamePhase::Finished
    {
        return Err(PokerError::InvalidGamePhase.into());
    }

    // Check timeout
    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;
    let time_since_last_action = current_time - game_state.last_action_timestamp;

    if time_since_last_action < game_config.timeout_seconds as i64 {
        return Err(PokerError::TimeoutNotReached.into());
    }

    // Identify offender (current turn player)
    let offender_key = player_list.get_player(game_state.current_turn)
        .ok_or(PokerError::NotAPlayer)?;

    // Validate offender state matches
    if offender_state.player != *offender_key {
        return Err(PokerError::InvalidAccountData.into());
    }

    // Calculate slash amount (percentage of offender's chips)
    let slash_amount = calculate_slash_amount(
        offender_state.chips,
        game_config.slash_percentage,
    );

    if slash_amount > 0 {
        // Transfer slashed chips to caller (or treasury)
        Transfer {
            from: chip_vault_acc,
            to: slash_recipient_acc,
            authority: game_config_acc,
            amount: slash_amount,
        }.invoke()?;

        // Deduct from offender
        offender_state.chips = offender_state.chips.saturating_sub(slash_amount);
    }

    // Force fold the offending player
    if !offender_state.is_folded() {
        offender_state.is_folded = 1;
        game_state.num_folded_players += 1;
    }

    // Update last action timestamp
    game_state.last_action_timestamp = current_time;

    // Check if only one player remaining
    let players_remaining = game_config.max_players - game_state.num_folded_players;
    if players_remaining == 1 {
        game_state.texas_state = TexasHoldEmState::ClaimPot as u8;
        msg!("EarlyEnd: Only one player remaining after slash");
    } else {
        // Move to next player
        game_state.current_turn = next_active_player(
            game_state.current_turn,
            game_config.max_players,
            &player_list,
            &offender_state,
        );
    }

    // Write updates
    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
        offender_state_acc.borrow_mut_data_unchecked()[..PLAYER_STATE_SIZE]
            .copy_from_slice(&offender_state.to_bytes());
    }

    msg!("PlayerSlashed");
    Ok(())
}

fn calculate_slash_amount(chips: u64, slash_percentage: u8) -> u64 {
    // slash_percentage is 0-100
    let percentage = slash_percentage.min(100) as u64;
    (chips * percentage) / 100
}

fn next_active_player(
    current: u8,
    max: u8,
    _player_list: &PlayerList,
    _offender_state: &PlayerState,
) -> u8 {
    // Simplified - in production would skip folded players
    (current + 1) % max
}
