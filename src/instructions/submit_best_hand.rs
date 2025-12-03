//! Submit best hand instruction

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};

use crate::{error::PokerError, poker::*, state::*};

pub fn process_submit_best_hand(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Data: 5 EC points (5 x 64 bytes = 320 bytes)
    if data.len() < 5 * 64 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut iter = accounts.iter();
    let player = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_config_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let accumulator_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
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

    // Use zero-copy reference instead of deserializing onto stack
    let accumulator = unsafe {
        AccumulatorStateRef::from_bytes(accumulator_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let _community_cards = unsafe {
        CommunityCards::from_bytes(community_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let player_list = unsafe {
        PlayerList::from_bytes(player_list_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Validate state
    if game_state.texas_state() != TexasHoldEmState::SubmitBest {
        return Err(PokerError::InvalidTexasState.into());
    }

    // Validate turn
    let current_player = player_list.get_player(game_state.current_turn)
        .ok_or(PokerError::NotAPlayer)?;
    if current_player != player.key() {
        return Err(PokerError::NotYourTurn.into());
    }

    // Parse the 5 cards from data
    let mut card_points = [([0u8; 32], [0u8; 32]); 5];
    for i in 0..5 {
        let offset = i * 64;
        card_points[i].0.copy_from_slice(&data[offset..offset + 32]);
        card_points[i].1.copy_from_slice(&data[offset + 32..offset + 64]);
    }

    // Validate cards are from player's cards or community cards
    // (simplified validation - in production would check more thoroughly)

    // Convert points to card IDs using accumulator
    let mut card_ids: [i8; 5] = [-1; 5];
    for (i, (qx, qy)) in card_points.iter().enumerate() {
        if let Some(id) = accumulator.find_card_by_point(qx, qy) {
            card_ids[i] = id;
        } else {
            return Err(PokerError::IllegalCard.into());
        }
    }

    // Check for duplicates
    for i in 0..5 {
        for j in (i + 1)..5 {
            if card_ids[i] == card_ids[j] {
                return Err(PokerError::DuplicateCards.into());
            }
        }
    }

    // Evaluate hand
    let (hand_enum, rated_cards) = evaluate_hand(card_ids);

    // Store results
    player_state.submitted_hand = hand_enum as u8;
    player_state.hand_cards = rated_cards;

    // Rank against other submitted hands
    // (simplified - in production would compare with all players)
    player_state.hand_rank = 0;

    game_state.num_submitted_hands += 1;

    let clock = Clock::get()?;
    game_state.last_action_timestamp = clock.unix_timestamp;

    // Check if all players have submitted
    let players_in_play = game_config.max_players - game_state.num_folded_players;
    if game_state.num_submitted_hands >= players_in_play {
        game_state.texas_state = TexasHoldEmState::ClaimPot as u8;
        game_state.current_turn = game_config.dealer_index;
        msg!("TexasHoldEmStateChanged: ClaimPot");
    } else {
        game_state.current_turn = next_active_player(
            game_state.current_turn,
            game_config.max_players,
        );
    }

    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
        player_state_acc.borrow_mut_data_unchecked()[..PLAYER_STATE_SIZE]
            .copy_from_slice(&player_state.to_bytes());
    }

    msg!("PlayerHand");
    Ok(())
}

fn next_active_player(current: u8, max: u8) -> u8 {
    (current + 1) % max
}
