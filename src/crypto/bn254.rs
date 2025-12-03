//! bn254 (alt_bn128) elliptic curve operations using Solana syscalls
//!
//! This module provides EC operations for the Mental Poker card encryption/decryption
//! protocol using Solana's native alt_bn128 syscalls via the solana-bn254 crate.

use crate::constants::{BN254_N, BN254_N_MINUS_2};
use crate::error::PokerError;
use solana_bn254::prelude::{
    alt_bn128_g1_addition_be, alt_bn128_g1_multiplication_be,
};
use solana_bn254::compression::prelude::{
    alt_bn128_g1_compress, alt_bn128_g1_decompress,
};

/// Size of a G1 point (uncompressed: x and y coordinates, 32 bytes each)
pub const G1_POINT_SIZE: usize = 64;

/// Size of a scalar (32 bytes)
pub const SCALAR_SIZE: usize = 32;

/// Size of a compressed G1 point (x coordinate with embedded sign bit)
pub const COMPRESSED_G1_SIZE: usize = 32;

/// Error returned by bn254 syscalls
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bn254Error {
    /// The syscall returned an error
    SyscallFailed,
    /// Invalid input size
    InvalidInputSize,
    /// Point not on curve
    InvalidPoint,
}

/// Perform G1 point addition: result = p1 + p2
/// Input: Two G1 points (128 bytes total)
/// Output: G1 point (64 bytes)
#[inline(never)]
pub fn bn254_add(p1: &[u8; G1_POINT_SIZE], p2: &[u8; G1_POINT_SIZE]) -> Result<[u8; G1_POINT_SIZE], Bn254Error> {
    let mut input = [0u8; 128];
    input[..64].copy_from_slice(p1);
    input[64..].copy_from_slice(p2);

    let result = alt_bn128_g1_addition_be(&input)
        .map_err(|_| Bn254Error::SyscallFailed)?;

    let mut out = [0u8; G1_POINT_SIZE];
    out.copy_from_slice(&result);
    Ok(out)
}

/// Perform G1 scalar multiplication: result = scalar * point
/// Input: G1 point (64 bytes) + scalar (32 bytes)
/// Output: G1 point (64 bytes)
#[inline(never)]
pub fn bn254_mul(point: &[u8; G1_POINT_SIZE], scalar: &[u8; SCALAR_SIZE]) -> Result<[u8; G1_POINT_SIZE], Bn254Error> {
    let mut input = [0u8; 96];
    input[..64].copy_from_slice(point);
    input[64..].copy_from_slice(scalar);

    let result = alt_bn128_g1_multiplication_be(&input)
        .map_err(|_| Bn254Error::SyscallFailed)?;

    let mut out = [0u8; G1_POINT_SIZE];
    out.copy_from_slice(&result);
    Ok(out)
}

/// Decompress a G1 point from compressed format
/// Input: 32 bytes (x coordinate with sign bit in top bit, big-endian)
/// Output: 64 bytes (uncompressed point: x || y)
///
/// Compute cost: ~3,400 CU per call
#[inline(never)]
pub fn bn254_g1_decompress(compressed: &[u8; COMPRESSED_G1_SIZE]) -> Result<[u8; G1_POINT_SIZE], Bn254Error> {
    let result = alt_bn128_g1_decompress(compressed)
        .map_err(|_| Bn254Error::SyscallFailed)?;

    Ok(result)
}

/// Compress a G1 point to compressed format (64 bytes → 32 bytes)
/// Input: 64 bytes (uncompressed point: x || y)
/// Output: 32 bytes (x coordinate with sign bit in top bit, big-endian)
#[inline(never)]
#[allow(dead_code)]
pub fn bn254_g1_compress(point: &[u8; G1_POINT_SIZE]) -> Result<[u8; COMPRESSED_G1_SIZE], Bn254Error> {
    let result = alt_bn128_g1_compress(point)
        .map_err(|_| Bn254Error::SyscallFailed)?;

    Ok(result)
}

// =============================================================================
// Modular Arithmetic for Scalars (needed for modular inverse)
// =============================================================================

/// Big integer comparison (returns: -1 if a < b, 0 if a == b, 1 if a > b)
#[inline]
fn bigint_cmp(a: &[u8; 32], b: &[u8; 32]) -> i8 {
    for i in 0..32 {
        if a[i] < b[i] {
            return -1;
        }
        if a[i] > b[i] {
            return 1;
        }
    }
    0
}

/// Big integer subtraction: result = a - b (assumes a >= b)
#[inline]
fn bigint_sub(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut result = [0u8; 32];
    let mut borrow: i16 = 0;

    for i in (0..32).rev() {
        let diff = a[i] as i16 - b[i] as i16 - borrow;
        if diff < 0 {
            result[i] = (diff + 256) as u8;
            borrow = 1;
        } else {
            result[i] = diff as u8;
            borrow = 0;
        }
    }

    result
}

/// Big integer addition: result = a + b
#[inline]
fn bigint_add(a: &[u8; 32], b: &[u8; 32]) -> ([u8; 32], bool) {
    let mut result = [0u8; 32];
    let mut carry: u16 = 0;

    for i in (0..32).rev() {
        let sum = a[i] as u16 + b[i] as u16 + carry;
        result[i] = sum as u8;
        carry = sum >> 8;
    }

    (result, carry != 0)
}

/// Big integer modular reduction: result = a mod n
#[inline]
fn bigint_mod(a: &[u8; 32], n: &[u8; 32]) -> [u8; 32] {
    let mut result = *a;
    while bigint_cmp(&result, n) >= 0 {
        result = bigint_sub(&result, n);
    }
    result
}

/// Big integer modular multiplication: result = (a * b) mod n
/// Uses double-and-add algorithm
#[inline(never)]
fn bigint_mul_mod(a: &[u8; 32], b: &[u8; 32], n: &[u8; 32]) -> [u8; 32] {
    let mut result = [0u8; 32];
    let mut temp_a = *a;

    for i in (0..32).rev() {
        for j in 0..8 {
            // If bit is set, add temp_a to result
            if (b[i] >> j) & 1 == 1 {
                let (sum, overflow) = bigint_add(&result, &temp_a);
                result = if overflow || bigint_cmp(&sum, n) >= 0 {
                    bigint_sub(&sum, n)
                } else {
                    sum
                };
            }

            // Double temp_a
            let (doubled, overflow) = bigint_add(&temp_a, &temp_a);
            temp_a = if overflow || bigint_cmp(&doubled, n) >= 0 {
                bigint_sub(&doubled, n)
            } else {
                doubled
            };
        }
    }

    result
}

/// Modular inverse using Fermat's little theorem: a^(-1) = a^(n-2) mod n
/// Uses the precomputed BN254_N_MINUS_2 constant.
///
/// Stack usage: ~200 bytes (two [u8; 32] arrays + loop variables)
#[inline(never)]
pub fn mod_inverse_bn254(a: &[u8; 32]) -> Option<[u8; 32]> {
    // Check for zero input (no inverse exists)
    let zero = [0u8; 32];
    if a == &zero {
        return None;
    }

    // Square-and-multiply exponentiation: a^(n-2) mod n
    let mut result = [0u8; 32];
    result[31] = 1; // Start with 1

    let mut base = bigint_mod(a, &BN254_N);

    // Iterate through bits of n-2 from LSB to MSB
    for i in (0..32).rev() {
        for j in 0..8 {
            if (BN254_N_MINUS_2[i] >> j) & 1 == 1 {
                result = bigint_mul_mod(&result, &base, &BN254_N);
            }
            base = bigint_mul_mod(&base, &base, &BN254_N);
        }
    }

    Some(result)
}

// =============================================================================
// High-Level Operations for Mental Poker
// =============================================================================

/// Decrypt an encrypted EC point using the inverse of the key.
/// This computes: result = (1/key) * point
///
/// This is the core operation for card decryption in Mental Poker.
/// The syscall handles the expensive point multiplication with zero stack impact.
///
/// # Arguments
/// * `key` - The encryption key scalar (32 bytes)
/// * `point` - The encrypted G1 point (64 bytes: x || y)
///
/// # Returns
/// * `Ok([u8; 64])` - The decrypted G1 point
/// * `Err(PokerError)` - If inverse computation or syscall fails
#[inline(never)]
pub fn decrypt_point(key: &[u8; 32], point: &[u8; 64]) -> Result<[u8; 64], PokerError> {
    // Compute scalar inverse: inv_key = key^(-1) mod n
    let inv_key = mod_inverse_bn254(key)
        .ok_or(PokerError::ECOperationFailed)?;

    // Use syscall for point multiplication: result = inv_key * point
    bn254_mul(point, &inv_key)
        .map_err(|_| PokerError::ECOperationFailed)
}

/// Decrypt a point given as separate (x, y) coordinates.
/// This is a convenience wrapper around `decrypt_point` for cases where
/// coordinates are stored separately.
#[inline(never)]
pub fn decrypt_point_coords(
    key: &[u8; 32],
    point_x: &[u8; 32],
    point_y: &[u8; 32],
) -> Result<([u8; 32], [u8; 32]), PokerError> {
    // Combine coordinates into a single point
    let mut point = [0u8; 64];
    point[..32].copy_from_slice(point_x);
    point[32..].copy_from_slice(point_y);

    // Decrypt
    let result = decrypt_point(key, &point)?;

    // Split result back into coordinates
    let mut x = [0u8; 32];
    let mut y = [0u8; 32];
    x.copy_from_slice(&result[..32]);
    y.copy_from_slice(&result[32..]);

    Ok((x, y))
}

/// Check if a point is the identity element (point at infinity)
/// In affine coordinates, this is represented as (0, 0)
#[inline]
pub fn is_identity(point: &[u8; 64]) -> bool {
    point.iter().all(|&b| b == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bigint_add() {
        let mut a = [0u8; 32];
        a[31] = 100;
        let mut b = [0u8; 32];
        b[31] = 55;

        let (result, overflow) = bigint_add(&a, &b);
        assert!(!overflow);
        assert_eq!(result[31], 155);
    }

    #[test]
    fn test_bigint_sub() {
        let mut a = [0u8; 32];
        a[31] = 100;
        let mut b = [0u8; 32];
        b[31] = 55;

        let result = bigint_sub(&a, &b);
        assert_eq!(result[31], 45);
    }

    #[test]
    fn test_mod_inverse_simple() {
        // Test: 2^(-1) mod n should give (n+1)/2 when n is odd
        let mut two = [0u8; 32];
        two[31] = 2;

        let inv = mod_inverse_bn254(&two);
        assert!(inv.is_some());

        // Verify: inv * 2 mod n == 1
        let result = bigint_mul_mod(&inv.unwrap(), &two, &BN254_N);
        let mut one = [0u8; 32];
        one[31] = 1;
        assert_eq!(result, one);
    }
}
