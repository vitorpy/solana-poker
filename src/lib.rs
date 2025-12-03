//! Mental Poker Texas Hold'em on Solana
//!
//! This program implements a Mental Poker protocol for Texas Hold'em
//! using elliptic curve cryptography on the secp256k1 curve.

pub mod constants;
pub mod entrypoint;
pub mod error;
pub mod processor;

pub mod crypto;
pub mod instructions;
pub mod poker;
pub mod state;
pub mod utils;

// Re-export for convenience
pub use constants::*;
pub use error::PokerError;

/// Program ID - base58 encoded: "PokerMenta1HoLdEm11111111111111111111111111"
pub const PROGRAM_ID: [u8; 32] = [
    0x0c, 0x64, 0x6e, 0x90, 0x56, 0x20, 0x55, 0x50, 0x8a, 0x02, 0xce, 0x8e, 0x72, 0xb7, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];
