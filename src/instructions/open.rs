//! Open player's hole card instruction
//!
//! The client provides the INVERSE of the lock key directly to avoid
//! expensive on-chain modular inverse computation.

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};

use crate::{constants::*, crypto::bn254::bn254_mul, error::PokerError, state::*};

pub fn process_open(
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
    let player_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
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

    let mut player_state = unsafe {
        PlayerState::from_bytes(player_state_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Use zero-copy mutable reference instead of deserializing onto stack
    let mut deck_state = unsafe {
        DeckStateMut::from_bytes(deck_state_acc.borrow_mut_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let community_cards = unsafe {
        CommunityCards::from_bytes(community_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let player_list = unsafe {
        PlayerList::from_bytes(player_list_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Validate state
    if game_state.betting_round_state() != BettingRoundState::Showdown {
        return Err(PokerError::InvalidBettingState.into());
    }

    // Validate turn
    let current_player = player_list.get_player(game_state.current_turn)
        .ok_or(PokerError::NotAPlayer)?;
    if current_player != player.key() {
        return Err(PokerError::NotYourTurn.into());
    }

    // Cannot open community cards here
    if community_cards.is_community_card(index) {
        return Err(PokerError::NotCommunityCard.into());
    }

    // Validate player hasn't opened 2 cards already
    if player_state.revealed_cards_count >= HOLE_CARDS_PER_PLAYER {
        return Err(PokerError::CannotDrawMoreCards.into());
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

    // Update player state
    let revealed_idx = player_state.revealed_cards_count as usize;
    player_state.revealed_cards[revealed_idx].0.copy_from_slice(&decrypted_x);
    player_state.revealed_cards[revealed_idx].1.copy_from_slice(&decrypted_y);
    player_state.revealed_cards_count += 1;

    game_state.player_cards_opened += 1;

    let clock = Clock::get()?;
    game_state.last_action_timestamp = clock.unix_timestamp;

    // Check if all players have opened their cards
    let players_in_play = game_config.max_players - game_state.num_folded_players;
    let total_cards_needed = players_in_play * HOLE_CARDS_PER_PLAYER;

    if game_state.player_cards_opened >= total_cards_needed {
        game_state.texas_state = TexasHoldEmState::SubmitBest as u8;
        game_state.current_turn = (game_config.dealer_index + 3) % game_config.max_players;
        msg!("TexasHoldEmStateChanged: SubmitBest");
    } else if player_state.revealed_cards_count >= HOLE_CARDS_PER_PLAYER {
        // This player is done, move to next
        game_state.current_turn = next_active_player(
            game_state.current_turn,
            game_config.max_players,
        );
    }

    // Write back game_state and player_state
    // Note: deck_state is already using zero-copy so writes go directly to account
    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
        player_state_acc.borrow_mut_data_unchecked()[..PLAYER_STATE_SIZE]
            .copy_from_slice(&player_state.to_bytes());
    }

    msg!("CardOpened");
    Ok(())
}

fn next_active_player(current: u8, max: u8) -> u8 {
    (current + 1) % max
}
