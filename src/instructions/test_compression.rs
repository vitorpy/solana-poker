//! Test instruction for debugging compression format
//!
//! Tests various scenarios

use pinocchio::{
    account_info::AccountInfo, msg, program_error::ProgramError, pubkey::Pubkey, ProgramResult,
};

use crate::crypto::bn254::{
    bn254_g1_compress, bn254_g1_decompress, bn254_mul, COMPRESSED_G1_SIZE, G1_POINT_SIZE, SCALAR_SIZE,
};
use crate::error::PokerError;

pub fn process_test_compression(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // Data format based on first byte:
    // 0 = test bn254_mul with raw uncompressed point (64 bytes)
    // 1 = test round-trip: compress → decompress → bn254_mul (64 bytes)
    // 2 = test client compression: decompress → bn254_mul (32 bytes)

    if data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let mode = data[0];
    let payload = &data[1..];

    match mode {
        0 => {
            // Test bn254_mul directly with uncompressed point
            msg!("TestCompression: Mode 0 - Direct bn254_mul test");

            if payload.len() < G1_POINT_SIZE {
                return Err(ProgramError::InvalidInstructionData);
            }

            let point: [u8; G1_POINT_SIZE] = payload[..64].try_into().unwrap();

            let scalar: [u8; SCALAR_SIZE] = {
                let mut s = [0u8; 32];
                s[31] = 1;
                s
            };

            msg!("TestCompression: Calling bn254_mul");
            let _result = bn254_mul(&point, &scalar)
                .map_err(|_| {
                    msg!("TestCompression: bn254_mul FAILED on raw point!");
                    PokerError::ECOperationFailed
                })?;

            msg!("TestCompression: bn254_mul SUCCESS on raw point!");
        }

        1 => {
            // Test round-trip
            msg!("TestCompression: Mode 1 - Round-trip test");

            if payload.len() < G1_POINT_SIZE {
                return Err(ProgramError::InvalidInstructionData);
            }

            let point: [u8; G1_POINT_SIZE] = payload[..64].try_into().unwrap();

            msg!("TestCompression: Step 1 - Compress");
            let compressed = bn254_g1_compress(&point)
                .map_err(|_| {
                    msg!("TestCompression: Compression FAILED!");
                    PokerError::ECOperationFailed
                })?;

            msg!("TestCompression: Step 2 - Decompress");
            let decompressed = bn254_g1_decompress(&compressed)
                .map_err(|_| {
                    msg!("TestCompression: Decompression FAILED!");
                    PokerError::DecompressionFailed
                })?;

            let scalar: [u8; SCALAR_SIZE] = {
                let mut s = [0u8; 32];
                s[31] = 1;
                s
            };

            msg!("TestCompression: Step 3 - bn254_mul on decompressed");
            let _result = bn254_mul(&decompressed, &scalar)
                .map_err(|_| {
                    msg!("TestCompression: bn254_mul FAILED on decompressed!");
                    PokerError::ECOperationFailed
                })?;

            msg!("TestCompression: Round-trip SUCCESS!");
        }

        2 => {
            // Test client compression
            msg!("TestCompression: Mode 2 - Client compression test");

            if payload.len() < COMPRESSED_G1_SIZE {
                return Err(ProgramError::InvalidInstructionData);
            }

            let compressed: [u8; COMPRESSED_G1_SIZE] = payload[..32].try_into().unwrap();

            msg!("TestCompression: Step 1 - Decompress");
            let decompressed = bn254_g1_decompress(&compressed)
                .map_err(|_| {
                    msg!("TestCompression: Decompression FAILED!");
                    PokerError::DecompressionFailed
                })?;

            let scalar: [u8; SCALAR_SIZE] = {
                let mut s = [0u8; 32];
                s[31] = 1;
                s
            };

            msg!("TestCompression: Step 2 - bn254_mul on decompressed");
            let _result = bn254_mul(&decompressed, &scalar)
                .map_err(|_| {
                    msg!("TestCompression: bn254_mul FAILED on decompressed!");
                    PokerError::ECOperationFailed
                })?;

            msg!("TestCompression: Client compression SUCCESS!");
        }

        _ => {
            return Err(ProgramError::InvalidInstructionData);
        }
    }

    Ok(())
}
