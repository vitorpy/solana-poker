//! Deal community cards instruction

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};

use crate::{error::PokerError, state::*};

pub fn process_deal_community(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let mut iter = accounts.iter();
    let player = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_config_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let deck_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let community_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
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

    // Use zero-copy mutable reference instead of deserializing onto stack
    let mut deck_state = unsafe {
        DeckStateMut::from_bytes(deck_state_acc.borrow_mut_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let mut community_cards = unsafe {
        CommunityCards::from_bytes(community_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let mut player_list = unsafe {
        PlayerList::from_bytes(player_list_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Validate state
    if game_state.texas_state() != TexasHoldEmState::CommunityCardsAwaiting {
        return Err(PokerError::InvalidTexasState.into());
    }

    // Validate turn (only dealer can deal)
    let current_player = player_list.get_player(game_state.current_turn)
        .ok_or(PokerError::NotAPlayer)?;
    if current_player != player.key() {
        return Err(PokerError::NotYourTurn.into());
    }

    // Check cards left
    if game_state.cards_left_in_deck == 0 {
        return Err(PokerError::NoCardsLeft.into());
    }

    // Validate we can deal more community cards in current phase
    match game_state.community_cards_state() {
        CommunityCardsState::FlopAwaiting => {
            if community_cards.card_count >= 3 {
                return Err(PokerError::InvalidCommunityCardsState.into());
            }
        }
        CommunityCardsState::TurnAwaiting => {
            if community_cards.card_count != 3 {
                return Err(PokerError::InvalidCommunityCardsState.into());
            }
        }
        CommunityCardsState::RiverAwaiting => {
            if community_cards.card_count != 4 {
                return Err(PokerError::InvalidCommunityCardsState.into());
            }
        }
        _ => return Err(PokerError::InvalidCommunityCardsState.into()),
    };

    // Deal ONE card at a time
    game_state.cards_left_in_deck -= 1;
    let card_index = game_state.cards_left_in_deck;

    // Mark card as owned by "community" (dealer)
    deck_state.set_card_owner(card_index as usize, player.key());
    community_cards.add_card(card_index);

    // Set card_to_reveal for the reveal phase
    game_state.card_to_reveal = card_index;

    // Update state to Opening/Revealing
    game_state.community_cards_state = CommunityCardsState::Opening as u8;
    game_state.drawing_state = DrawingState::Revealing as u8;

    // Reset revealed flags in player list for new reveal round
    player_list.reset_revealed();

    msg!("CommunityCardDrawn");

    let clock = Clock::get()?;
    game_state.last_action_timestamp = clock.unix_timestamp;

    // Write back game_state, community_cards, and player_list
    // Note: deck_state writes go directly to account via zero-copy
    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
        community_acc.borrow_mut_data_unchecked()[..COMMUNITY_CARDS_SIZE]
            .copy_from_slice(&community_cards.to_bytes());
        player_list_acc.borrow_mut_data_unchecked()[..PLAYER_LIST_SIZE]
            .copy_from_slice(&player_list.to_bytes());
    }

    msg!("CommunityCardsStateChanged: Opening");
    Ok(())
}
