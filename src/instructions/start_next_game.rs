//! Start next game instruction - resets state for a new hand

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar}, ProgramResult,
};

use crate::{constants::*, error::PokerError, state::*};

pub fn process_start_next_game(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let mut iter = accounts.iter();
    let player = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_config_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let deck_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let accumulator_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let community_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_list_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;

    // Collect player state accounts
    const MAX_PLAYERS_USIZE: usize = MAX_PLAYERS as usize;
    let mut player_states_accounts: [Option<&AccountInfo>; MAX_PLAYERS_USIZE] = [None; MAX_PLAYERS_USIZE];
    for i in 0..MAX_PLAYERS as usize {
        player_states_accounts[i] = iter.next();
    }

    if !player.is_signer() {
        return Err(PokerError::InvalidSigner.into());
    }

    let mut game_config = unsafe {
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

    // Validate state - must be finished or pot claimed
    if game_state.texas_state() != TexasHoldEmState::Finished
        && game_state.texas_state() != TexasHoldEmState::ClaimPot
    {
        return Err(PokerError::InvalidTexasState.into());
    }

    // Validate caller is a player
    let _caller_idx = player_list.find_player(player.key())
        .ok_or(PokerError::NotAPlayer)?;

    // Validate pot has been claimed (if we're in ClaimPot state)
    if game_state.texas_state() == TexasHoldEmState::ClaimPot
        && game_state.pot_claimed == 0
    {
        return Err(PokerError::PotNotClaimed.into());
    }

    // Rotate dealer position
    game_config.dealer_index = (game_config.dealer_index + 1) % game_config.max_players;

    // Increment game number
    game_config.game_number += 1;

    // Reset game state
    let clock = Clock::get()?;
    game_state.reset();
    game_state.last_action_timestamp = clock.unix_timestamp;
    game_state.cards_left_in_deck = DECK_SIZE as u8;

    // Since players are already in the game, advance to Shuffling phase
    if game_config.current_players >= MIN_PLAYERS {
        game_state.game_phase = GamePhase::Shuffling as u8;
        game_state.shuffling_state = ShufflingState::Generating as u8;
        game_state.current_turn = (game_config.dealer_index + 3) % game_config.max_players;
    }

    // Reset deck state (use zero-copy to avoid 3361-byte stack allocation)
    let mut deck_state = unsafe {
        DeckStateMut::from_bytes(deck_state_acc.borrow_mut_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };
    deck_state.reset_for_next_game();

    // Reset accumulator (use zero-copy to avoid 5025-byte stack allocation)
    let mut accumulator = unsafe {
        AccumulatorStateMut::from_bytes(accumulator_acc.borrow_mut_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };
    accumulator.reset_accumulator();

    // Reset community cards
    let mut community_cards = unsafe {
        CommunityCards::from_bytes(community_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };
    community_cards.reset();

    // Reset all player states
    for i in 0..game_config.max_players {
        if let Some(state_acc) = player_states_accounts[i as usize] {
            let mut player_state = unsafe {
                PlayerState::from_bytes(state_acc.borrow_data_unchecked())
                    .ok_or(PokerError::InvalidAccountData)?
            };

            // Keep player key and chip count, reset everything else
            player_state.reset_for_new_game();

            unsafe {
                state_acc.borrow_mut_data_unchecked()[..PLAYER_STATE_SIZE]
                    .copy_from_slice(&player_state.to_bytes());
            }
        }
    }

    // Write all state updates
    // Note: deck_state and accumulator writes go directly to account via zero-copy
    unsafe {
        game_config_acc.borrow_mut_data_unchecked()[..GAME_CONFIG_SIZE]
            .copy_from_slice(&game_config.to_bytes());
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
        community_acc.borrow_mut_data_unchecked()[..COMMUNITY_CARDS_SIZE]
            .copy_from_slice(&community_cards.to_bytes());
    }

    msg!("NextGameStarted");
    Ok(())
}

impl GameState {
    pub fn reset(&mut self) {
        self.game_phase = GamePhase::WaitingForPlayers as u8;
        self.shuffling_state = ShufflingState::NotStarted as u8;
        self.drawing_state = DrawingState::NotDrawn as u8;
        self.texas_state = TexasHoldEmState::NotStarted as u8;
        self.betting_round_state = BettingRoundState::PreFlop as u8;
        self.community_cards_state = CommunityCardsState::FlopAwaiting as u8;
        self.current_turn = 0;
        self.cards_left_in_deck = DECK_SIZE as u8;
        self.num_folded_players = 0;
        self.pot_size = 0;
        self.pot = 0;
        self.current_bet = 0;
        self.current_call_amount = 0;
        self.last_raise = 0;
        self.last_to_call = [0u8; 32];
        self.num_submitted_hands = 0;
        self.player_cards_opened = 0;
        self.pot_claimed = 0;
        self.is_everybody_all_in = 0;
        self.is_deck_submitted = 0;
        self.cards_drawn = 0;
        self.card_to_reveal = 0;
        self.active_player_count = 0;
    }
}

impl DeckState {
    pub fn reset(&mut self) {
        self.reset_for_next_game();
    }
}

impl AccumulatorState {
    pub fn reset(&mut self) {
        self.reset_for_next_game();
    }
}

impl CommunityCards {
    pub fn reset(&mut self) {
        self.reset_for_next_game();
    }
}

impl PlayerState {
    pub fn reset_for_new_game(&mut self) {
        self.reset_for_next_game();
    }
}
