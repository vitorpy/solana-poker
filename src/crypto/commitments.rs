//! Commitment scheme for Mental Poker shuffling
//!
//! Uses Keccak256 hash for commitment-reveal pattern

extern "C" {
    fn sol_keccak256(vals: *const u8, val_len: u64, hash_result: *mut u8) -> u64;
}

/// Keccak256 using Solana's native syscall
pub fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hash = [0u8; 32];

    // Create a "slice of slices" structure that the syscall expects
    // Format: [ptr, len] pairs
    let slice_desc: [usize; 2] = [data.as_ptr() as usize, data.len()];

    unsafe {
        sol_keccak256(
            slice_desc.as_ptr() as *const u8,
            1, // number of slices
            hash.as_mut_ptr(),
        );
    }

    hash
}

/// Compute commitment for a shuffle vector
/// commitment = keccak256(abi.encode(vector))
pub fn compute_commitment(vector: &[[u8; 32]; 52]) -> [u8; 32] {
    // Flatten the vector into a byte array
    let mut data = [0u8; 52 * 32];
    for (i, v) in vector.iter().enumerate() {
        data[i * 32..(i + 1) * 32].copy_from_slice(v);
    }

    keccak256(&data)
}

/// Compute commitment directly from flat byte slice (no stack allocation)
/// This is the zero-copy version that works with instruction data directly
pub fn compute_commitment_from_slice(data: &[u8]) -> [u8; 32] {
    keccak256(data)
}

/// Verify that a commitment matches a revealed vector
pub fn verify_commitment(commitment: &[u8; 32], vector: &[[u8; 32]; 52]) -> bool {
    let computed = compute_commitment(vector);
    *commitment == computed
}

// Tests require cargo test-sbf (syscall not available in native tests)
