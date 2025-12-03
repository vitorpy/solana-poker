//! Close game instruction
//!
//! Closes all game PDA accounts and returns rent to the authority.
//! Can only be called when the game is finished or by authority to abort.

use pinocchio::{account_info::AccountInfo, msg, program_error::ProgramError, ProgramResult};

use crate::{
    error::PokerError,
    state::{GameConfig, GameState, TexasHoldEmState},
};

/// Close a PDA account by transferring all lamports to the destination
/// and zeroing the account data.
#[inline(never)]
fn close_pda_account(pda: &AccountInfo, destination: &AccountInfo) -> ProgramResult {
    // Transfer all lamports to destination
    unsafe {
        let dest_lamports = destination.borrow_mut_lamports_unchecked();
        let pda_lamports = pda.borrow_mut_lamports_unchecked();

        *dest_lamports = dest_lamports
            .checked_add(*pda_lamports)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        *pda_lamports = 0;

        // Zero account data for security
        let data = pda.borrow_mut_data_unchecked();
        data.fill(0);
    }

    Ok(())
}

pub fn process_close_game(
    _program_id: &pinocchio::pubkey::Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    msg!("CloseGame: start");

    // Parse game_id from instruction data
    if data.len() < 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let mut game_id = [0u8; 32];
    game_id.copy_from_slice(&data[0..32]);

    // Optional force_close flag (only authority can use)
    let force_close = data.len() > 32 && data[32] != 0;

    // Parse accounts
    let mut iter = accounts.iter();
    let authority = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_config_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let deck_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let accumulator_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let community_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_list_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;

    // Authority must sign
    if !authority.is_signer() {
        return Err(PokerError::InvalidSigner.into());
    }

    // Verify game_config
    let config_data = unsafe { game_config_acc.borrow_data_unchecked() };
    let game_config =
        GameConfig::from_bytes(config_data).ok_or(ProgramError::InvalidAccountData)?;

    // Verify authority matches
    if game_config.authority != *authority.key() {
        return Err(PokerError::InvalidAuthority.into());
    }

    // Verify game_id matches
    if game_config.game_id != game_id {
        return Err(PokerError::InvalidGameId.into());
    }

    // Check game state - must be finished or force_close by authority
    if !force_close {
        let state_data = unsafe { game_state_acc.borrow_data_unchecked() };
        let game_state =
            GameState::from_bytes(state_data).ok_or(ProgramError::InvalidAccountData)?;

        // Game must be in Finished state or StartNext (if all players left)
        let is_finished = game_state.texas_state == TexasHoldEmState::Finished as u8
            || game_state.texas_state == TexasHoldEmState::StartNext as u8;

        if !is_finished && game_config.current_players > 0 {
            msg!("CloseGame: game not finished and players still active");
            return Err(PokerError::GameNotFinished.into());
        }
    }

    msg!("CloseGame: closing accounts");

    // Close all PDA accounts, transferring lamports to authority
    close_pda_account(game_config_acc, authority)?;
    close_pda_account(game_state_acc, authority)?;
    close_pda_account(deck_state_acc, authority)?;
    close_pda_account(accumulator_acc, authority)?;
    close_pda_account(community_acc, authority)?;
    close_pda_account(player_list_acc, authority)?;

    msg!("Game closed, rent returned to authority");
    Ok(())
}
