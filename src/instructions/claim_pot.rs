//! Claim pot instruction - distributes pot to winner(s)
//!
//! Transfers SPL tokens from the vault to winner(s) using PDA signing.

use pinocchio::{
    account_info::AccountInfo,
    instruction::{Seed, Signer},
    msg, program_error::ProgramError, pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};
use pinocchio_token::instructions::Transfer;

use crate::{constants::*, error::PokerError, state::*};

const MAX_PLAYERS_USIZE: usize = MAX_PLAYERS as usize;

pub fn process_claim_pot(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let mut iter = accounts.iter();
    let player = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_config_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let pot_account = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let _player_token_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_list_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let _token_program = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;

    // Collect all player state accounts
    let mut player_states_accounts: [Option<&AccountInfo>; MAX_PLAYERS_USIZE] = [None; MAX_PLAYERS_USIZE];
    for i in 0..MAX_PLAYERS_USIZE {
        player_states_accounts[i] = iter.next();
    }

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
    if game_state.texas_state() != TexasHoldEmState::ClaimPot {
        return Err(PokerError::InvalidTexasState.into());
    }

    // Check if already claimed
    if game_state.pot_claimed != 0 {
        return Err(PokerError::PotAlreadyClaimed.into());
    }

    // Determine winner(s)
    let (winners, _winning_hand) = determine_winners(
        &player_list,
        &player_states_accounts,
        game_config.max_players,
        &game_state,
    )?;

    if winners.is_empty() {
        return Err(PokerError::NoWinner.into());
    }

    // Calculate pot distribution
    let total_pot = game_state.pot;
    let num_winners = winners.len() as u64;
    let share_per_winner = total_pot / num_winners;
    let remainder = total_pot % num_winners;

    // PDA signer components (reused in loop)
    let bump_slice = [game_config.bump];

    // Transfer to each winner
    for (i, winner_idx) in winners.iter().enumerate() {
        let _winner_pubkey = player_list.get_player(*winner_idx)
            .ok_or(PokerError::NotAPlayer)?;

        // Find winner's token account in remaining accounts
        let winner_token_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;

        // Calculate this winner's share (first winner gets remainder)
        let amount = if i == 0 {
            share_per_winner + remainder
        } else {
            share_per_winner
        };

        if amount > 0 {
            // Build signer for this transfer (must be rebuilt each iteration)
            let seeds: [Seed; 3] = [
                Seed::from(GAME_CONFIG_SEED),
                Seed::from(&game_config.game_id[..]),
                Seed::from(bump_slice.as_slice()),
            ];
            let signer = Signer::from(&seeds);

            // Transfer from pot to winner using PDA signature
            Transfer {
                from: pot_account,
                to: winner_token_acc,
                authority: game_config_acc,
                amount,
            }.invoke_signed(&[signer])?;

            msg!("PotTransfer");
        }
    }

    // Mark pot as claimed
    game_state.pot_claimed = 1;
    game_state.pot = 0;  // Note: pot is the serialized field, pot_size is an alias

    let clock = Clock::get()?;
    game_state.last_action_timestamp = clock.unix_timestamp;

    // Move to next game state
    game_state.texas_state = TexasHoldEmState::Finished as u8;

    unsafe {
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
    }

    msg!("PotClaimed");
    Ok(())
}

fn determine_winners(
    player_list: &PlayerList,
    player_states: &[Option<&AccountInfo>; MAX_PLAYERS_USIZE],
    max_players: u8,
    game_state: &GameState,
) -> Result<(Vec<u8>, u8), ProgramError> {
    let mut best_hand: u8 = 0;
    let mut best_cards: [i8; 5] = [-1; 5];
    let mut winners: Vec<u8> = Vec::new();

    // Check if only one player remaining (others folded)
    let players_remaining = max_players - game_state.num_folded_players;
    if players_remaining == 1 {
        // Find the non-folded player
        for i in 0..max_players {
            if let Some(state_acc) = player_states[i as usize] {
                let player_state = unsafe {
                    PlayerState::from_bytes(state_acc.borrow_data_unchecked())
                        .ok_or(PokerError::InvalidAccountData)?
                };
                if !player_state.is_folded() {
                    return Ok((vec![i], 0));
                }
            }
        }
    }

    // Compare submitted hands
    for i in 0..max_players {
        if player_list.get_player(i).is_none() {
            continue;
        }

        if let Some(state_acc) = player_states[i as usize] {
            let player_state = unsafe {
                PlayerState::from_bytes(state_acc.borrow_data_unchecked())
                    .ok_or(PokerError::InvalidAccountData)?
            };

            // Skip folded players
            if player_state.is_folded() {
                continue;
            }

            let hand = player_state.submitted_hand;
            let cards = player_state.hand_cards;

            if hand > best_hand {
                best_hand = hand;
                best_cards = cards;
                winners.clear();
                winners.push(i);
            } else if hand == best_hand {
                // Compare card values for tiebreaker
                let comparison = compare_hands(cards, best_cards);
                if comparison > 0 {
                    best_cards = cards;
                    winners.clear();
                    winners.push(i);
                } else if comparison == 0 {
                    // Tie - add to winners
                    winners.push(i);
                }
            }
        }
    }

    Ok((winners, best_hand))
}

fn compare_hands(hand1: [i8; 5], hand2: [i8; 5]) -> i8 {
    // Compare card by card (assuming sorted highest first)
    for i in 0..5 {
        if hand1[i] > hand2[i] {
            return 1;
        } else if hand1[i] < hand2[i] {
            return -1;
        }
    }
    0 // Exact tie
}
