//! Account validation helpers

use pinocchio::{account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey};

use crate::error::PokerError;

/// Validate that an account is a signer
pub fn validate_signer(account: &AccountInfo) -> Result<(), ProgramError> {
    if !account.is_signer() {
        return Err(PokerError::InvalidSigner.into());
    }
    Ok(())
}

/// Validate that an account is owned by a specific program
pub fn validate_owner(account: &AccountInfo, expected_owner: &Pubkey) -> Result<(), ProgramError> {
    if account.owner() != expected_owner {
        return Err(PokerError::InvalidOwner.into());
    }
    Ok(())
}

/// Validate that an account is writable
pub fn validate_writable(account: &AccountInfo) -> Result<(), ProgramError> {
    if !account.is_writable() {
        return Err(ProgramError::InvalidAccountData);
    }
    Ok(())
}

/// Validate that an account matches an expected pubkey
pub fn validate_pubkey(account: &AccountInfo, expected: &Pubkey) -> Result<(), ProgramError> {
    if account.key() != expected {
        return Err(PokerError::InvalidPDA.into());
    }
    Ok(())
}

/// Validate that an account is initialized (has data)
pub fn validate_initialized(account: &AccountInfo) -> Result<(), ProgramError> {
    if account.data_len() == 0 {
        return Err(PokerError::AccountNotInitialized.into());
    }
    Ok(())
}

/// Validate that an account is not initialized (empty)
pub fn validate_not_initialized(account: &AccountInfo) -> Result<(), ProgramError> {
    if account.data_len() > 0 {
        return Err(PokerError::AccountAlreadyInitialized.into());
    }
    Ok(())
}

/// Validate minimum account balance for rent
pub fn validate_rent_exempt(account: &AccountInfo, min_balance: u64) -> Result<(), ProgramError> {
    if account.lamports() < min_balance {
        return Err(PokerError::InsufficientRent.into());
    }
    Ok(())
}

/// Get the next turn index, skipping folded players
pub fn get_next_turn(current: u8, max_players: u8, is_folded: impl Fn(u8) -> bool) -> u8 {
    let mut next = (current + 1) % max_players;
    while is_folded(next) {
        next = (next + 1) % max_players;
    }
    next
}

/// Get the previous index in circular fashion
pub fn get_previous_index(current: u8, max: u8) -> u8 {
    if current == 0 {
        max - 1
    } else {
        current - 1
    }
}

/// Get the first to call index (dealer + 3, skipping folded/all-in)
pub fn get_first_to_call(
    dealer_index: u8,
    max_players: u8,
    is_folded: impl Fn(u8) -> bool,
    has_chips: impl Fn(u8) -> bool,
) -> u8 {
    let mut index = (dealer_index + 3) % max_players;
    while is_folded(index) && has_chips(index) {
        index = (index + 1) % max_players;
    }
    index
}
