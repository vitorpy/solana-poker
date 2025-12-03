//! Fold instruction

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};

use crate::{error::PokerError, state::*};

pub fn process_fold(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
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

    // Validate turn
    let current_player = player_list.get_player(game_state.current_turn)
        .ok_or(PokerError::NotAPlayer)?;
    if current_player != player.key() {
        return Err(PokerError::NotYourTurn.into());
    }

    // Validate not already folded
    if player_state.is_folded() {
        return Err(PokerError::AlreadyFolded.into());
    }

    // Mark as folded
    player_state.is_folded = 1;
    game_state.num_folded_players += 1;

    let clock = Clock::get()?;
    game_state.last_action_timestamp = clock.unix_timestamp;

    // Check if only one player left
    let players_remaining = game_config.max_players - game_state.num_folded_players;
    if players_remaining == 1 {
        // Early end - last player wins
        game_state.texas_state = TexasHoldEmState::ClaimPot as u8;
        msg!("EarlyEnd: Only one player remaining");
    } else if game_state.last_to_call == *player.key() {
        // Betting round complete
        finish_betting_round(&mut game_state, &game_config);
    } else {
        // Next turn
        game_state.current_turn = next_active_player(
            game_state.current_turn,
            game_config.max_players,
            game_state.num_folded_players,
        );
    }

    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
        player_state_acc.borrow_mut_data_unchecked()[..PLAYER_STATE_SIZE]
            .copy_from_slice(&player_state.to_bytes());
    }

    msg!("PlayerFolded");
    Ok(())
}

fn next_active_player(current: u8, max: u8, _folded: u8) -> u8 {
    // Simplified - in production would skip folded players
    (current + 1) % max
}

fn finish_betting_round(game_state: &mut GameState, game_config: &GameConfig) {
    match game_state.betting_round_state() {
        BettingRoundState::PreFlop => {
            game_state.texas_state = TexasHoldEmState::CommunityCardsAwaiting as u8;
            game_state.community_cards_state = CommunityCardsState::FlopAwaiting as u8;
        }
        BettingRoundState::PostFlop => {
            game_state.texas_state = TexasHoldEmState::CommunityCardsAwaiting as u8;
            game_state.community_cards_state = CommunityCardsState::TurnAwaiting as u8;
        }
        BettingRoundState::PostTurn => {
            game_state.texas_state = TexasHoldEmState::CommunityCardsAwaiting as u8;
            game_state.community_cards_state = CommunityCardsState::RiverAwaiting as u8;
        }
        BettingRoundState::Showdown => {
            game_state.texas_state = TexasHoldEmState::Revealing as u8;
        }
        _ => {}
    }
    game_state.current_turn = game_config.dealer_index;
}
