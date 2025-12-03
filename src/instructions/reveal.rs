//! Reveal card instruction - other players decrypt a drawn card
//!
//! The client provides the INVERSE of the lock key directly. This avoids
//! expensive on-chain modular inverse computation. Verification happens
//! at card reveal time when the decrypted card must match the original deck.

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};

use crate::{constants::*, crypto::bn254::bn254_mul, error::PokerError, state::*};

pub fn process_reveal(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Data: inv_key(32) + index(1) = 33 bytes
    // inv_key is the modular inverse of the lock key, computed off-chain
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

    let mut player_list = unsafe {
        PlayerList::from_bytes(player_list_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Validate state
    if game_state.drawing_state() != DrawingState::Revealing {
        return Err(PokerError::InvalidDrawingState.into());
    }

    // Validate card index
    if index != game_state.card_to_reveal {
        return Err(PokerError::InvalidCardIndex.into());
    }

    // Owner cannot reveal their own card
    let card_owner = deck_state.get_card_owner(index as usize);
    if card_owner == player.key() {
        return Err(PokerError::NotCardOwner.into());
    }

    // Check player hasn't already revealed
    let player_index = player_list.find_player_index(player.key())
        .ok_or(PokerError::NotAPlayer)?;
    if player_list.has_revealed(player_index) {
        return Err(PokerError::PlayerAlreadyRevealed.into());
    }

    // Get current card point (zero-copy reference)
    let (qx, qy) = deck_state.get_card_point(index as usize);

    // Combine point coordinates for syscall
    let mut point = [0u8; 64];
    point[..32].copy_from_slice(qx);
    point[32..].copy_from_slice(qy);

    // Apply decryption using bn254 syscall: new_point = inv_key * point
    // The client provides the inverse key directly to avoid expensive on-chain computation
    let decrypted = bn254_mul(&point, &inv_key)
        .map_err(|_| PokerError::ECOperationFailed)?;

    // Split result back into coordinates
    let mut decrypted_x = [0u8; 32];
    let mut decrypted_y = [0u8; 32];
    decrypted_x.copy_from_slice(&decrypted[..32]);
    decrypted_y.copy_from_slice(&decrypted[32..]);

    // Update deck with decrypted point (direct write to account data)
    deck_state.set_card_point(index as usize, &decrypted_x, &decrypted_y);

    // Mark player as having revealed
    player_list.mark_revealed(player_index);

    let clock = Clock::get()?;
    game_state.last_action_timestamp = clock.unix_timestamp;

    // Check if all non-owners have revealed (max_players - 1)
    if player_list.count_revealed() >= game_config.max_players - 1 {
        // Check if this is a community card reveal (texas_state == CommunityCardsAwaiting)
        // or a hole card reveal (texas_state == Drawing)
        if game_state.texas_state() == TexasHoldEmState::CommunityCardsAwaiting {
            // Community card reveal complete - ready for dealer to open the card
            // Don't change any states, just mark drawing_state as Picking so dealer can open
            game_state.drawing_state = DrawingState::Picking as u8;
            msg!("CommunityCardRevealComplete");
        } else {
            // Hole card reveal
            game_state.drawing_state = DrawingState::Picking as u8;

            // Check if all cards drawn for this phase
            let total_cards_needed = (game_config.max_players as u8) * HOLE_CARDS_PER_PLAYER;
            if game_state.cards_drawn >= total_cards_needed {
                game_state.texas_state = TexasHoldEmState::Betting as u8;
                game_state.betting_round_state = BettingRoundState::PreFlop as u8;
                game_state.current_turn = (game_config.dealer_index + 3) % game_config.max_players;

                // Set last_to_call to big blind player - if action returns to them, round ends
                let bb_index = (game_config.dealer_index + 2) % game_config.max_players;
                if let Some(bb_player) = player_list.get_player(bb_index) {
                    game_state.last_to_call = *bb_player;
                }

                msg!("TexasHoldEmStateChanged: Betting");
                msg!("BettingRoundStateChanged: PreFlop");
            } else {
                // Next player draws
                game_state.current_turn = (game_state.current_turn + 1) % game_config.max_players;
            }

            msg!("DrawingStateChanged: Picking");
        }
    }

    // Write back game_state and player_list
    // Note: deck_state is already using zero-copy so writes go directly to account
    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
        player_list_acc.borrow_mut_data_unchecked()[..PLAYER_LIST_SIZE]
            .copy_from_slice(&player_list.to_bytes());
    }

    msg!("CardRevealed");
    Ok(())
}
