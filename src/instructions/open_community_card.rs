//! Open community card instruction
//!
//! The client provides the INVERSE of the lock key directly to avoid
//! expensive on-chain modular inverse computation.

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};

use crate::{crypto::bn254::bn254_mul, error::PokerError, state::*};

pub fn process_open_community_card(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Data: inv_key(32) + index(1) = 33 bytes
    if data.len() < 33 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut inv_key = [0u8; 32];
    inv_key.copy_from_slice(&data[0..32]);
    let index = data[32];

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

    let game_config = unsafe {
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

    let player_list = unsafe {
        PlayerList::from_bytes(player_list_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Validate that the opener is the card owner (the dealer who dealt this card)
    let card_owner = deck_state.get_card_owner(index as usize);
    if card_owner != player.key() {
        return Err(PokerError::NotCardOwner.into());
    }

    // Validate this is a community card
    if !community_cards.is_community_card(index) {
        return Err(PokerError::NotCommunityCard.into());
    }

    // Get current card point (zero-copy reference)
    let (qx, qy) = deck_state.get_card_point(index as usize);

    // Combine point coordinates for syscall
    let mut point = [0u8; 64];
    point[..32].copy_from_slice(qx);
    point[32..].copy_from_slice(qy);

    // Apply decryption using bn254 syscall: new_point = inv_key * point
    let decrypted = bn254_mul(&point, &inv_key)
        .map_err(|_| PokerError::ECOperationFailed)?;

    // Split result back into coordinates
    let mut decrypted_x = [0u8; 32];
    let mut decrypted_y = [0u8; 32];
    decrypted_x.copy_from_slice(&decrypted[..32]);
    decrypted_y.copy_from_slice(&decrypted[32..]);

    // Update deck (direct write to account data)
    deck_state.set_card_point(index as usize, &decrypted_x, &decrypted_y);
    deck_state.clear_card_owner(index as usize);

    // Add to opened cards
    community_cards.add_opened_card(&decrypted_x, &decrypted_y);

    let clock = Clock::get()?;
    game_state.last_action_timestamp = clock.unix_timestamp;

    // Update state based on opened count
    let opened = community_cards.opened_count;
    if opened < 3 {
        // Still opening flop - need more cards
        game_state.texas_state = TexasHoldEmState::CommunityCardsAwaiting as u8;
        game_state.community_cards_state = CommunityCardsState::FlopAwaiting as u8;
        // Set turn back to dealer so they can deal the next card
        game_state.current_turn = game_config.dealer_index;
    } else if opened == 3 {
        // Flop complete - start post-flop betting
        game_state.texas_state = TexasHoldEmState::Betting as u8;
        game_state.betting_round_state = BettingRoundState::PostFlop as u8;
        // Action starts at first player after dealer
        let first_to_act = (game_config.dealer_index + 1) % game_config.max_players;
        game_state.current_turn = first_to_act;
        // Last to call is the dealer (button) - round ends when action returns to them
        if let Some(dealer_player) = player_list.get_player(game_config.dealer_index) {
            game_state.last_to_call = *dealer_player;
        }
        // Reset current_call_amount for new betting round
        game_state.current_call_amount = 0;
        msg!("BettingRoundStateChanged: PostFlop");
    } else if opened == 4 {
        // Turn complete - start post-turn betting
        game_state.texas_state = TexasHoldEmState::Betting as u8;
        game_state.betting_round_state = BettingRoundState::PostTurn as u8;
        let first_to_act = (game_config.dealer_index + 1) % game_config.max_players;
        game_state.current_turn = first_to_act;
        if let Some(dealer_player) = player_list.get_player(game_config.dealer_index) {
            game_state.last_to_call = *dealer_player;
        }
        game_state.current_call_amount = 0;
        msg!("BettingRoundStateChanged: PostTurn");
    } else if opened == 5 {
        // River complete - start final betting (showdown)
        game_state.texas_state = TexasHoldEmState::Betting as u8;
        game_state.betting_round_state = BettingRoundState::Showdown as u8;
        let first_to_act = (game_config.dealer_index + 1) % game_config.max_players;
        game_state.current_turn = first_to_act;
        if let Some(dealer_player) = player_list.get_player(game_config.dealer_index) {
            game_state.last_to_call = *dealer_player;
        }
        game_state.current_call_amount = 0;
        msg!("BettingRoundStateChanged: Showdown");
    }

    // Write back game_state and community_cards
    // Note: deck_state is already using zero-copy so writes go directly to account
    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
        community_acc.borrow_mut_data_unchecked()[..COMMUNITY_CARDS_SIZE]
            .copy_from_slice(&community_cards.to_bytes());
    }

    msg!("CardOpened");
    Ok(())
}
