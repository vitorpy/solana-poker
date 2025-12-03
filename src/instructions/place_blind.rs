//! Place blind instruction

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};

use crate::{error::PokerError, state::*};

pub fn process_place_blind(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());

    let mut iter = accounts.iter();
    let player = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_config_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
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

    let mut player_state = unsafe {
        PlayerState::from_bytes(player_state_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let player_list = unsafe {
        PlayerList::from_bytes(player_list_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Validate state
    if game_state.texas_state() != TexasHoldEmState::Betting {
        return Err(PokerError::InvalidTexasState.into());
    }
    if game_state.betting_round_state() != BettingRoundState::Blinds {
        return Err(PokerError::InvalidBettingState.into());
    }

    // Validate turn
    let current_player = player_list.get_player(game_state.current_turn)
        .ok_or(PokerError::NotAPlayer)?;
    if current_player != player.key() {
        return Err(PokerError::NotYourTurn.into());
    }

    // Validate amount
    if player_state.chips < amount {
        return Err(PokerError::InsufficientChips.into());
    }

    // Check if small blind or big blind
    if game_state.current_call_amount == 0 {
        // Small blind
        let expected = game_config.small_blind.min(player_state.chips);
        if player_state.current_bet + amount != expected && amount != player_state.chips {
            return Err(PokerError::InvalidSmallBlind.into());
        }
    } else {
        // Big blind
        let expected = (game_config.small_blind * 2).min(player_state.chips);
        if player_state.current_bet + amount != expected && amount != player_state.chips {
            return Err(PokerError::InvalidBigBlind.into());
        }
    }

    // Place chips
    player_state.chips -= amount;
    player_state.current_bet += amount;
    game_state.pot += amount;
    game_state.current_call_amount = player_state.current_bet;

    let clock = Clock::get()?;
    game_state.last_action_timestamp = clock.unix_timestamp;

    // Check if blinds are complete
    if game_state.current_call_amount == game_config.small_blind {
        // Move to big blind
        game_state.current_turn = (game_state.current_turn + 1) % game_config.max_players;
    } else {
        // Blinds complete, move to drawing
        game_state.texas_state = TexasHoldEmState::Drawing as u8;
        game_state.current_turn = (game_config.dealer_index + 3) % game_config.max_players;
        msg!("TexasHoldEmStateChanged: Drawing");
    }

    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
        player_state_acc.borrow_mut_data_unchecked()[..PLAYER_STATE_SIZE]
            .copy_from_slice(&player_state.to_bytes());
    }

    msg!("BlindPlaced");
    Ok(())
}
