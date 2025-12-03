//! Initialize game instruction
//!
//! Creates all PDA accounts via CPI to System Program and initializes them.
//! Also creates and initializes the vault as an SPL token account.

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

use crate::{constants::*, error::PokerError, state::*};

/// System program ID
const SYSTEM_PROGRAM_ID: Pubkey = [0u8; 32];

/// Create and initialize a PDA token account via CPI
#[inline(never)]
fn create_pda_token_account<'a>(
    payer: &'a AccountInfo,
    vault: &'a AccountInfo,
    token_mint: &'a AccountInfo,
    authority: &'a AccountInfo, // game_config PDA - will be token account authority
    system_program: &'a AccountInfo,
    token_program: &'a AccountInfo,
    seed1: &[u8],
    seed2: &[u8],
    bump: u8,
    rent: &Rent,
) -> ProgramResult {
    let lamports = rent.minimum_balance(TOKEN_ACCOUNT_SIZE);

    // Build create_account instruction data
    // System program create_account instruction: index 0
    // Data layout: instruction_index (4 bytes LE) + lamports (8 bytes LE) + space (8 bytes LE) + owner (32 bytes)
    let mut ix_data = [0u8; 4 + 8 + 8 + 32];
    ix_data[0..4].copy_from_slice(&0u32.to_le_bytes()); // create_account = 0
    ix_data[4..12].copy_from_slice(&lamports.to_le_bytes());
    ix_data[12..20].copy_from_slice(&(TOKEN_ACCOUNT_SIZE as u64).to_le_bytes());
    ix_data[20..52].copy_from_slice(&TOKEN_PROGRAM_ID); // Owner is Token Program

    // Account metas for create_account: [from, to]
    let account_metas = [
        AccountMeta {
            pubkey: payer.key(),
            is_signer: true,
            is_writable: true,
        },
        AccountMeta {
            pubkey: vault.key(),
            is_signer: true, // PDA signs via invoke_signed
            is_writable: true,
        },
    ];

    let create_instruction = Instruction {
        program_id: &SYSTEM_PROGRAM_ID,
        accounts: &account_metas,
        data: &ix_data,
    };

    // Build signer seeds for vault PDA
    let bump_slice = [bump];
    let seeds: [Seed; 3] = [
        Seed::from(seed1),
        Seed::from(seed2),
        Seed::from(bump_slice.as_slice()),
    ];
    let signer = Signer::from(&seeds);

    invoke_signed::<3>(&create_instruction, &[payer, vault, system_program], &[signer])?;

    // Now initialize the token account
    // SPL Token InitializeAccount3 instruction (index 18) - takes owner as instruction data
    // This is simpler than InitializeAccount which requires rent sysvar
    // Format: [18] + owner pubkey (32 bytes)
    let mut init_data = [0u8; 33];
    init_data[0] = 18; // InitializeAccount3
    init_data[1..33].copy_from_slice(authority.key()); // Owner = game_config PDA

    let init_account_metas = [
        AccountMeta {
            pubkey: vault.key(),
            is_signer: false,
            is_writable: true,
        },
        AccountMeta {
            pubkey: token_mint.key(),
            is_signer: false,
            is_writable: false,
        },
    ];

    let init_instruction = Instruction {
        program_id: &TOKEN_PROGRAM_ID,
        accounts: &init_account_metas,
        data: &init_data,
    };

    // No PDA signing needed for InitializeAccount3 - the account is already created and owned by Token Program
    pinocchio::program::invoke(&init_instruction, &[vault, token_mint, token_program])?;

    Ok(())
}

/// Write initial deck state directly to account data (avoids 3361-byte stack allocation)
#[inline(never)]
fn write_deck_state_initial(data: &mut [u8], bump: u8, game_id: &[u8; 32]) {
    data[0] = bump;
    data[1..33].copy_from_slice(game_id);
}

/// Write initial accumulator state directly to account data (avoids 5025-byte stack allocation)
#[inline(never)]
fn write_accumulator_initial(data: &mut [u8], bump: u8, game_id: &[u8; 32]) {
    data[0] = bump;
    data[1..33].copy_from_slice(game_id);
}

/// Create a PDA account via CPI to System Program
#[inline(never)]
fn create_pda_account<'a>(
    payer: &'a AccountInfo,
    pda: &'a AccountInfo,
    system_program: &'a AccountInfo,
    program_id: &Pubkey,
    seed1: &[u8],
    seed2: &[u8],
    bump: u8,
    space: usize,
    rent: &Rent,
) -> ProgramResult {
    let lamports = rent.minimum_balance(space);

    // Build create_account instruction data
    // System program create_account instruction: index 0
    // Data layout: instruction_index (4 bytes LE) + lamports (8 bytes LE) + space (8 bytes LE) + owner (32 bytes)
    let mut ix_data = [0u8; 4 + 8 + 8 + 32];
    ix_data[0..4].copy_from_slice(&0u32.to_le_bytes()); // create_account = 0
    ix_data[4..12].copy_from_slice(&lamports.to_le_bytes());
    ix_data[12..20].copy_from_slice(&(space as u64).to_le_bytes());
    ix_data[20..52].copy_from_slice(program_id);

    // Account metas for create_account: [from, to]
    let account_metas = [
        AccountMeta {
            pubkey: payer.key(),
            is_signer: true,
            is_writable: true,
        },
        AccountMeta {
            pubkey: pda.key(),
            is_signer: true, // PDA signs via invoke_signed
            is_writable: true,
        },
    ];

    let instruction = Instruction {
        program_id: &SYSTEM_PROGRAM_ID,
        accounts: &account_metas,
        data: &ix_data,
    };

    // Build signer seeds
    let bump_slice = [bump];
    let seeds: [Seed; 3] = [
        Seed::from(seed1),
        Seed::from(seed2),
        Seed::from(bump_slice.as_slice()),
    ];
    let signer = Signer::from(&seeds);

    invoke_signed::<3>(&instruction, &[payer, pda, system_program], &[signer])
}

pub fn process_initialize_game(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    msg!("InitializeGame: start");

    if data.len() < 49 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mut game_id = [0u8; 32];
    game_id.copy_from_slice(&data[0..32]);
    let max_players = data[32];
    let small_blind = u64::from_le_bytes(
        data[33..41]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );
    let min_buy_in = u64::from_le_bytes(
        data[41..49]
            .try_into()
            .map_err(|_| ProgramError::InvalidInstructionData)?,
    );

    if max_players < MIN_PLAYERS || max_players > MAX_PLAYERS {
        return Err(PokerError::InvalidNumPlayers.into());
    }
    if small_blind == 0 {
        return Err(PokerError::InvalidSmallBlind.into());
    }
    if min_buy_in <= small_blind * 2 {
        return Err(PokerError::MinBuyInTooLow.into());
    }

    // Parse accounts
    let mut iter = accounts.iter();
    let authority = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_config_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let game_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let deck_state_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let accumulator_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let community_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let player_list_acc = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let token_mint = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let vault = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let system_program = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;
    let token_program = iter.next().ok_or(ProgramError::NotEnoughAccountKeys)?;

    if !authority.is_signer() {
        return Err(PokerError::InvalidSigner.into());
    }

    // Verify system program
    if system_program.key() != &SYSTEM_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Verify token program
    if token_program.key() != &TOKEN_PROGRAM_ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    // Derive PDA bumps
    let (_, config_bump) = find_program_address(&[GAME_CONFIG_SEED, &game_id], program_id);
    let (_, state_bump) = find_program_address(&[GAME_STATE_SEED, &game_id], program_id);
    let (_, deck_bump) = find_program_address(&[DECK_STATE_SEED, &game_id], program_id);
    let (_, acc_bump) = find_program_address(&[ACCUMULATOR_SEED, &game_id], program_id);
    let (_, comm_bump) = find_program_address(&[COMMUNITY_CARDS_SEED, &game_id], program_id);
    let (_, list_bump) = find_program_address(&[PLAYER_LIST_SEED, &game_id], program_id);
    let (_, vault_bump) = find_program_address(&[VAULT_SEED, &game_id], program_id);

    // Get rent sysvar
    let rent = Rent::get()?;
    let clock = Clock::get()?;

    msg!("InitializeGame: creating accounts via CPI");

    // Create game_config account
    create_pda_account(
        authority,
        game_config_acc,
        system_program,
        program_id,
        GAME_CONFIG_SEED,
        &game_id,
        config_bump,
        GAME_CONFIG_SIZE,
        &rent,
    )?;

    // Create game_state account
    create_pda_account(
        authority,
        game_state_acc,
        system_program,
        program_id,
        GAME_STATE_SEED,
        &game_id,
        state_bump,
        GAME_STATE_SIZE,
        &rent,
    )?;

    // Create deck_state account
    create_pda_account(
        authority,
        deck_state_acc,
        system_program,
        program_id,
        DECK_STATE_SEED,
        &game_id,
        deck_bump,
        DECK_STATE_SIZE,
        &rent,
    )?;

    // Create accumulator account
    create_pda_account(
        authority,
        accumulator_acc,
        system_program,
        program_id,
        ACCUMULATOR_SEED,
        &game_id,
        acc_bump,
        ACCUMULATOR_STATE_SIZE,
        &rent,
    )?;

    // Create community_cards account
    create_pda_account(
        authority,
        community_acc,
        system_program,
        program_id,
        COMMUNITY_CARDS_SEED,
        &game_id,
        comm_bump,
        COMMUNITY_CARDS_SIZE,
        &rent,
    )?;

    // Create player_list account
    create_pda_account(
        authority,
        player_list_acc,
        system_program,
        program_id,
        PLAYER_LIST_SEED,
        &game_id,
        list_bump,
        PLAYER_LIST_SIZE,
        &rent,
    )?;

    // Create vault as SPL token account (owned by Token Program, authority = game_config)
    create_pda_token_account(
        authority,
        vault,
        token_mint,
        game_config_acc, // game_config PDA will be the token authority
        system_program,
        token_program,
        VAULT_SEED,
        &game_id,
        vault_bump,
        &rent,
    )?;

    msg!("InitializeGame: initializing account data");

    // Initialize account data
    let game_config = GameConfig::new(
        config_bump,
        game_id,
        *authority.key(),
        *token_mint.key(),
        max_players,
        small_blind,
        min_buy_in,
        clock.unix_timestamp,
    );
    let game_state = GameState::new(state_bump, game_id, clock.unix_timestamp);
    let community = CommunityCards::new(comm_bump, game_id);
    let player_list = PlayerList::new(list_bump, game_id);

    // Write to accounts
    unsafe {
        game_config_acc.borrow_mut_data_unchecked()[..GAME_CONFIG_SIZE]
            .copy_from_slice(&game_config.to_bytes());
        game_state_acc.borrow_mut_data_unchecked()[..GAME_STATE_SIZE]
            .copy_from_slice(&game_state.to_bytes());
        write_deck_state_initial(
            deck_state_acc.borrow_mut_data_unchecked(),
            deck_bump,
            &game_id,
        );
        write_accumulator_initial(
            accumulator_acc.borrow_mut_data_unchecked(),
            acc_bump,
            &game_id,
        );
        community_acc.borrow_mut_data_unchecked()[..COMMUNITY_CARDS_SIZE]
            .copy_from_slice(&community.to_bytes());
        player_list_acc.borrow_mut_data_unchecked()[..PLAYER_LIST_SIZE]
            .copy_from_slice(&player_list.to_bytes());
    }

    msg!("Game initialized");
    Ok(())
}
