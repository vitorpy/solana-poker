//! Bet instruction (call/raise)

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};

use crate::{error::PokerError, state::*};

pub fn process_bet(
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

    // Validate turn
    let current_player = player_list.get_player(game_state.current_turn)
        .ok_or(PokerError::NotAPlayer)?;
    if current_player != player.key() {
        return Err(PokerError::NotYourTurn.into());
    }

    // Validate not folded
    if player_state.is_folded() {
        return Err(PokerError::AlreadyFolded.into());
    }

    // Validate amount
    if player_state.chips < amount {
        return Err(PokerError::InsufficientChips.into());
    }

    // Must call or raise (or all-in)
    let new_bet = player_state.current_bet + amount;
    if new_bet < game_state.current_call_amount && amount != player_state.chips {
        return Err(PokerError::InvalidBetAmount.into());
    }

    // Place chips
    player_state.chips -= amount;
    player_state.current_bet = new_bet;
    game_state.pot += amount;

    // Check if raise
    if new_bet > game_state.current_call_amount {
        game_state.current_call_amount = new_bet;
        // Set last to call to previous player
        let prev_index = if game_state.current_turn == 0 {
            game_config.max_players - 1
        } else {
            game_state.current_turn - 1
        };
        if let Some(prev_player) = player_list.get_player(prev_index) {
            game_state.last_to_call = *prev_player;
        }
        msg!("PlayerRaised");
    } else {
        msg!("PlayerCalled");
    }

    let clock = Clock::get()?;
    game_state.last_action_timestamp = clock.unix_timestamp;

    // Check if betting round complete
    if game_state.last_to_call == *player.key() || check_all_in(&game_state, &player_list, accounts) {
        finish_betting_round(&mut game_state, &game_config);
    } else {
        // Next turn
        game_state.current_turn = next_active_player(
            game_state.current_turn,
            game_config.max_players,
            &player_list,
            accounts,
        );
    }

    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
        player_state_acc.borrow_mut_data_unchecked()[..PLAYER_STATE_SIZE]
            .copy_from_slice(&player_state.to_bytes());
    }

    Ok(())
}

fn check_all_in(_game_state: &GameState, _player_list: &PlayerList, _accounts: &[AccountInfo]) -> bool {
    // Simplified - would need to check all players' chips
    false
}

fn next_active_player(current: u8, max: u8, _player_list: &PlayerList, _accounts: &[AccountInfo]) -> u8 {
    // Simplified - would need to skip folded players
    (current + 1) % max
}

fn finish_betting_round(game_state: &mut GameState, game_config: &GameConfig) {
    match game_state.betting_round_state() {
        BettingRoundState::Blinds => {
            game_state.texas_state = TexasHoldEmState::Drawing as u8;
        }
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
    }
    game_state.current_turn = game_config.dealer_index;
    msg!("BettingRoundFinished");
}
