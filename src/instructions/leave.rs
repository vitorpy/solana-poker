//! Leave game instruction - allows player to withdraw from game

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_token::instructions::Transfer;

use crate::{constants::{MAX_PLAYERS, HOLE_CARDS_PER_PLAYER}, error::PokerError, state::*};

pub fn process_leave(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    let mut iter = accounts.iter();
    let player = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_config_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_list_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let chip_vault_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_token_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let _token_program = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;

    if !player.is_signer() {
        return Err(PokerError::InvalidSigner.into());
    }

    let mut game_config = unsafe {
        GameConfig::from_bytes(game_config_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let game_state = unsafe {
        GameState::from_bytes(game_state_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let mut player_state = unsafe {
        PlayerState::from_bytes(player_state_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let mut player_list = unsafe {
        PlayerList::from_bytes(player_list_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    // Validate player is in game
    let player_idx = player_list.find_player(player.key())
        .ok_or(PokerError::NotAPlayer)?;

    // Validate player state matches
    if player_state.player != *player.key() {
        return Err(PokerError::InvalidSigner.into());
    }

    // Can only leave during certain states
    let can_leave = match game_state.game_phase() {
        GamePhase::WaitingForPlayers => true,
        GamePhase::Finished => true,
        _ => {
            // During game, can only leave if:
            // 1. Player has folded, OR
            // 2. Game is in ClaimPot state and pot has been claimed
            player_state.is_folded()
                || (game_state.texas_state() == TexasHoldEmState::ClaimPot
                    && game_state.pot_claimed != 0)
                || game_state.texas_state() == TexasHoldEmState::Finished
        }
    };

    if !can_leave {
        return Err(PokerError::CannotLeaveNow.into());
    }

    // Calculate chips to return (player's remaining chips minus any committed bets)
    let chips_to_return = player_state.chips;

    // Transfer chips back to player
    if chips_to_return > 0 {
        Transfer {
            from: chip_vault_acc,
            to: player_token_acc,
            authority: game_config_acc,
            amount: chips_to_return,
        }.invoke()?;
    }

    // Remove player from list
    player_list.remove_player(player_idx);

    // Update game config
    game_config.current_players = game_config.current_players.saturating_sub(1);

    // Clear player state
    player_state.clear();

    // Write updates
    unsafe {
        game_config_acc.borrow_mut_data_unchecked()[..GAME_CONFIG_SIZE]
            .copy_from_slice(&game_config.to_bytes());
        player_state_acc.borrow_mut_data_unchecked()[..PLAYER_STATE_SIZE]
            .copy_from_slice(&player_state.to_bytes());
        player_list_acc.borrow_mut_data_unchecked()[..PLAYER_LIST_SIZE]
            .copy_from_slice(&player_list.to_bytes());
    }

    msg!("PlayerLeft");
    Ok(())
}

impl PlayerList {
    pub fn remove_player(&mut self, index: u8) {
        if (index as usize) < (MAX_PLAYERS as usize) {
            self.players[index as usize] = [0u8; 32];
            self.player_count = self.player_count.saturating_sub(1);
        }
    }
}

impl PlayerState {
    pub fn clear(&mut self) {
        self.player = [0u8; 32];
        self.seat_index = 0;
        self.chips = 0;
        self.is_folded = 0;
        self.current_bet = 0;
        self.revealed_cards_count = 0;
        self.revealed_cards = [([0u8; 32], [0u8; 32]); HOLE_CARDS_PER_PLAYER as usize];
        self.submitted_hand = 0;
        self.hand_cards = [-1i8; 5];
        self.hand_rank = 0;
    }
}
