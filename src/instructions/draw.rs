//! Draw card instruction

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};

use crate::{constants::*, error::PokerError, state::*};

pub fn process_draw(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let mut iter = accounts.iter();
    let player = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_config_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let deck_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_list_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;

    if !player.is_signer() {
        return Err(PokerError::InvalidSigner.into());
    }

    let _game_config = unsafe {
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

    // Use zero-copy mutable reference instead of deserializing onto stack
    let mut deck_state = unsafe {
        DeckStateMut::from_bytes(deck_state_acc.borrow_mut_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let mut player_list = unsafe {
        PlayerList::from_bytes(player_list_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Validate state
    if game_state.texas_state() != TexasHoldEmState::Drawing {
        return Err(PokerError::InvalidTexasState.into());
    }
    if game_state.drawing_state() != DrawingState::Picking {
        return Err(PokerError::InvalidDrawingState.into());
    }

    // Validate turn
    let current_player = player_list.get_player(game_state.current_turn)
        .ok_or(PokerError::NotAPlayer)?;
    if current_player != player.key() {
        return Err(PokerError::NotYourTurn.into());
    }

    // Check player hasn't drawn 2 cards already
    if player_state.hole_cards_count >= HOLE_CARDS_PER_PLAYER {
        return Err(PokerError::CannotDrawMoreCards.into());
    }

    // Check cards left in deck
    if game_state.cards_left_in_deck == 0 {
        return Err(PokerError::NoCardsLeft.into());
    }

    // Draw card from top of deck
    game_state.cards_left_in_deck -= 1;
    let card_index = game_state.cards_left_in_deck;

    // Assign card to player
    deck_state.set_card_owner(card_index as usize, player.key());
    player_state.hole_cards[player_state.hole_cards_count as usize] = card_index;
    player_state.hole_cards_count += 1;

    game_state.cards_drawn += 1;
    game_state.drawing_state = DrawingState::Revealing as u8;
    game_state.card_to_reveal = card_index;

    // Reset revealed bitmap for this card
    player_list.reset_revealed();

    let clock = Clock::get()?;
    game_state.last_action_timestamp = clock.unix_timestamp;

    // Write back game_state, player_state, player_list
    // Note: deck_state writes go directly to account via zero-copy
    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
        player_state_acc.borrow_mut_data_unchecked()[..PLAYER_STATE_SIZE]
            .copy_from_slice(&player_state.to_bytes());
        player_list_acc.borrow_mut_data_unchecked()[..PLAYER_LIST_SIZE]
            .copy_from_slice(&player_list.to_bytes());
    }

    msg!("PlayerCardDrawn");
    Ok(())
}
