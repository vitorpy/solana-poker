//! Cryptographic operations for Mental Poker
//!
//! Provides elliptic curve operations and commitment schemes for card encryption.
//!
//! ## Modules
//! - `bn254` - Primary EC operations using Solana's native alt_bn128 syscalls (recommended)
//! - `secp256k1` - Legacy EC operations (high stack usage, deprecated)
//! - `commitments` - Keccak256 commitment scheme for shuffle verification

pub mod bn254;
pub mod commitments;
pub mod secp256k1;

pub use bn254::*;
pub use commitments::*;
// Note: secp256k1 is not re-exported by default to encourage use of bn254
