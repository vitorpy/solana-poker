//! Join game instruction
//!
//! Player joins the game by depositing tokens into the vault.

use pinocchio::{
    account_info::AccountInfo,
    instruction::{AccountMeta, Instruction, Seed, Signer},
    msg,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::{find_program_address, Pubkey},
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};
use pinocchio_token::instructions::Transfer;

use crate::{constants::*, error::PokerError, state::*};

/// System program ID
const SYSTEM_PROGRAM_ID: Pubkey = [0u8; 32];

/// Create a PDA account via CPI to System Program
#[inline(never)]
fn create_player_state_account<'a>(
    payer: &'a AccountInfo,
    pda: &'a AccountInfo,
    system_program: &'a AccountInfo,
    program_id: &Pubkey,
    game_id: &[u8; 32],
    player_key: &Pubkey,
    bump: u8,
    rent: &Rent,
) -> ProgramResult {
    let lamports = rent.minimum_balance(PLAYER_STATE_SIZE);

    // Build create_account instruction data
    let mut ix_data = [0u8; 4 + 8 + 8 + 32];
    ix_data[0..4].copy_from_slice(&0u32.to_le_bytes()); // create_account = 0
    ix_data[4..12].copy_from_slice(&lamports.to_le_bytes());
    ix_data[12..20].copy_from_slice(&(PLAYER_STATE_SIZE as u64).to_le_bytes());
    ix_data[20..52].copy_from_slice(program_id);

    let account_metas = [
        AccountMeta {
            pubkey: payer.key(),
            is_signer: true,
            is_writable: true,
        },
        AccountMeta {
            pubkey: pda.key(),
            is_signer: true,
            is_writable: true,
        },
    ];

    let instruction = Instruction {
        program_id: &SYSTEM_PROGRAM_ID,
        accounts: &account_metas,
        data: &ix_data,
    };

    // Build signer seeds: ["player", game_id, player_key, bump]
    let bump_slice = [bump];
    let seeds: [Seed; 4] = [
        Seed::from(PLAYER_STATE_SEED),
        Seed::from(game_id.as_slice()),
        Seed::from(player_key.as_slice()),
        Seed::from(bump_slice.as_slice()),
    ];
    let signer = Signer::from(&seeds);

    invoke_signed::<3>(&instruction, &[payer, pda, system_program], &[signer])
}

pub fn process_join_game(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    if data.len() < 40 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut commitment = [0u8; 32];
    commitment.copy_from_slice(&data[0..32]);
    let deposit_amount = u64::from_le_bytes(data[32..40].try_into().unwrap());

    let mut iter = accounts.iter();
    let player = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_config_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_list_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_token_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let vault = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let system_program = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let _token_program = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;

    if !player.is_signer() {
        return Err(PokerError::InvalidSigner.into());
    }

    // Verify system program
    if system_program.key() != &SYSTEM_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    let mut game_config = unsafe {
        GameConfig::from_bytes(game_config_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let mut game_state = unsafe {
        GameState::from_bytes(game_state_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    let mut player_list = unsafe {
        PlayerList::from_bytes(player_list_acc.borrow_data_unchecked())
            .ok_or(PokerError::InvalidAccountData)?
    };

    if !game_config.is_accepting_players() {
        return Err(PokerError::GameFull.into());
    }

    if game_state.shuffling_state() != ShufflingState::Committing {
        return Err(PokerError::InvalidShufflingState.into());
    }

    if deposit_amount < game_config.min_buy_in {
        return Err(PokerError::InsufficientChips.into());
    }

    let (_, player_bump) = find_program_address(
        &[PLAYER_STATE_SEED, &game_config.game_id, player.key()],
        program_id,
    );

    // Create player_state account via CPI
    let rent = Rent::get()?;
    create_player_state_account(
        player,
        player_state_acc,
        system_program,
        program_id,
        &game_config.game_id,
        player.key(),
        player_bump,
        &rent,
    )?;

    let seat_index = player_list.add_player(*player.key()).ok_or(PokerError::GameFull)?;

    // Transfer tokens from player's token account to vault
    Transfer {
        from: player_token_acc,
        to: vault,
        authority: player,
        amount: deposit_amount,
    }
    .invoke()?;

    msg!("DepositTransferred");

    // Update current_players count
    game_config.current_players = game_config.current_players.saturating_add(1);

    let player_state = PlayerState::new(
        player_bump, game_config.game_id, *player.key(),
        seat_index, deposit_amount, commitment,
    );

    let clock = Clock::get()?;

    if player_list.count >= game_config.max_players {
        game_state.shuffling_state = ShufflingState::Generating as u8;
        game_state.current_turn = (game_config.dealer_index + 3) % game_config.max_players;
        msg!("ShufflingStateChanged: Generating");
    }

    game_state.last_action_timestamp = clock.unix_timestamp;

    unsafe {
        game_config_acc.borrow_mut_data_unchecked()[..GAME_CONFIG_SIZE]
            .copy_from_slice(&game_config.to_bytes());
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
        player_state_acc.borrow_mut_data_unchecked()[..PLAYER_STATE_SIZE]
            .copy_from_slice(&player_state.to_bytes());
        player_list_acc.borrow_mut_data_unchecked()[..PLAYER_LIST_SIZE]
            .copy_from_slice(&player_list.to_bytes());
    }

    msg!("PlayerJoined");
    Ok(())
}
