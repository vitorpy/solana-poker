//! Lock deck instruction - final shuffle round

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};

use crate::{constants::*, error::PokerError, state::*};

pub fn process_lock(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Data: 52 EC points (52 x 64 bytes)
    if data.len() < DECK_SIZE * 64 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut iter = accounts.iter();
    let player = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_config_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let deck_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
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

    let player_list = unsafe {
        PlayerList::from_bytes(player_list_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Validate state
    if game_state.game_phase() != GamePhase::Shuffling {
        return Err(PokerError::InvalidState.into());
    }
    if game_state.shuffling_state() != ShufflingState::Locking {
        return Err(PokerError::InvalidShufflingState.into());
    }

    // Validate turn
    let current_player = player_list.get_player(game_state.current_turn)
        .ok_or(PokerError::NotAPlayer)?;
    if current_player != player.key() {
        return Err(PokerError::NotYourTurn.into());
    }

    // Use zero-copy mutable reference instead of deserializing onto stack
    let mut deck_state = unsafe {
        DeckStateMut::from_bytes(deck_state_acc.borrow_mut_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Update deck with locked points (direct writes to account data)
    for i in 0..DECK_SIZE {
        let offset = i * 64;
        // Read coordinates from instruction data using zero-copy
        let qx = unsafe { &*(data[offset..].as_ptr() as *const [u8; 32]) };
        let qy = unsafe { &*(data[offset + 32..].as_ptr() as *const [u8; 32]) };
        deck_state.set_card_point(i, qx, qy);
    }

    game_state.active_player_count += 1;

    let clock = Clock::get()?;
    game_state.last_action_timestamp = clock.unix_timestamp;

    // Check if all players have locked
    if game_state.active_player_count >= game_config.max_players {
        game_state.game_phase = GamePhase::Drawing as u8;
        game_state.drawing_state = DrawingState::Picking as u8;
        game_state.active_player_count = 0;
        game_state.current_turn = (game_config.dealer_index + 1) % game_config.max_players;
        msg!("GameStateChanged: Drawing");
    } else {
        game_state.current_turn = (game_state.current_turn + 1) % game_config.max_players;
    }

    // Write back game_state only (deck_state writes go directly to account)
    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
    }

    msg!("WorkDeckUpdate");
    Ok(())
}
