//! secp256k1 elliptic curve operations
//!
//! Ported from Utils.sol - provides EC point multiplication and modular inverse
//! for the Mental Poker card encryption/decryption protocol.
//!
//! The curve equation is: y² = x³ + 7 (mod p)
//! Where p = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F

use crate::constants::{SECP256K1_N, SECP256K1_P};

/// EC Point representation (uncompressed)
#[derive(Clone, Copy, Debug, Default)]
pub struct ECPoint {
    pub x: [u8; 32],
    pub y: [u8; 32],
}

impl ECPoint {
    pub fn new(x: [u8; 32], y: [u8; 32]) -> Self {
        Self { x, y }
    }

    pub fn from_bytes(data: &[u8]) -> Option<Self> {
        if data.len() < 64 {
            return None;
        }
        let mut x = [0u8; 32];
        let mut y = [0u8; 32];
        x.copy_from_slice(&data[..32]);
        y.copy_from_slice(&data[32..64]);
        Some(Self { x, y })
    }

    pub fn to_bytes(&self) -> [u8; 64] {
        let mut bytes = [0u8; 64];
        bytes[..32].copy_from_slice(&self.x);
        bytes[32..].copy_from_slice(&self.y);
        bytes
    }

    pub fn is_zero(&self) -> bool {
        self.x == [0u8; 32] && self.y == [0u8; 32]
    }
}

/// Big integer comparison (returns: -1 if a < b, 0 if a == b, 1 if a > b)
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

/// Big integer modular reduction: result = a mod p
fn bigint_mod(a: &[u8; 32], p: &[u8; 32]) -> [u8; 32] {
    let mut result = *a;
    while bigint_cmp(&result, p) >= 0 {
        result = bigint_sub(&result, p);
    }
    result
}

/// Big integer multiplication: result = a * b (returns lower 32 bytes, enough for our use)
fn bigint_mul_mod(a: &[u8; 32], b: &[u8; 32], p: &[u8; 32]) -> [u8; 32] {
    // For proper implementation, we'd need 64-byte intermediate results
    // This is a simplified version using double-and-add
    let mut result = [0u8; 32];
    let mut temp_a = *a;

    for i in (0..32).rev() {
        for j in 0..8 {
            // If bit is set, add temp_a to result
            if (b[i] >> j) & 1 == 1 {
                let (sum, overflow) = bigint_add(&result, &temp_a);
                result = if overflow || bigint_cmp(&sum, p) >= 0 {
                    bigint_sub(&sum, p)
                } else {
                    sum
                };
            }

            // Double temp_a
            let (doubled, overflow) = bigint_add(&temp_a, &temp_a);
            temp_a = if overflow || bigint_cmp(&doubled, p) >= 0 {
                bigint_sub(&doubled, p)
            } else {
                doubled
            };
        }
    }

    result
}

/// Extended Euclidean Algorithm for modular inverse
/// Returns a^(-1) mod n
pub fn mod_inverse(a: &[u8; 32], n: &[u8; 32]) -> Option<[u8; 32]> {
    // Using Fermat's little theorem: a^(-1) = a^(n-2) mod n (for prime n)
    // This is simpler but slower than extended GCD

    let mut exp = *n;
    // exp = n - 2
    let two = {
        let mut t = [0u8; 32];
        t[31] = 2;
        t
    };
    exp = bigint_sub(&exp, &two);

    // Compute a^exp mod n using square-and-multiply
    let mut result = {
        let mut one = [0u8; 32];
        one[31] = 1;
        one
    };
    let mut base = bigint_mod(a, n);

    for i in (0..32).rev() {
        for j in 0..8 {
            if (exp[i] >> j) & 1 == 1 {
                result = bigint_mul_mod(&result, &base, n);
            }
            base = bigint_mul_mod(&base, &base, n);
        }
    }

    Some(result)
}

/// EC Point doubling: result = 2 * P
pub fn ec_double(p: &ECPoint) -> ECPoint {
    if p.is_zero() {
        return ECPoint::default();
    }

    // lambda = (3 * x^2 + a) / (2 * y) mod p
    // For secp256k1, a = 0, so lambda = (3 * x^2) / (2 * y)

    let three = {
        let mut t = [0u8; 32];
        t[31] = 3;
        t
    };
    let two = {
        let mut t = [0u8; 32];
        t[31] = 2;
        t
    };

    // x^2 mod p
    let x_squared = bigint_mul_mod(&p.x, &p.x, &SECP256K1_P);
    // 3 * x^2 mod p
    let numerator = bigint_mul_mod(&three, &x_squared, &SECP256K1_P);
    // 2 * y mod p
    let denominator = bigint_mul_mod(&two, &p.y, &SECP256K1_P);

    // lambda = numerator / denominator = numerator * denominator^(-1)
    let denom_inv = match mod_inverse(&denominator, &SECP256K1_P) {
        Some(inv) => inv,
        None => return ECPoint::default(),
    };
    let lambda = bigint_mul_mod(&numerator, &denom_inv, &SECP256K1_P);

    // x3 = lambda^2 - 2*x mod p
    let lambda_squared = bigint_mul_mod(&lambda, &lambda, &SECP256K1_P);
    let two_x = bigint_mul_mod(&two, &p.x, &SECP256K1_P);
    let x3 = if bigint_cmp(&lambda_squared, &two_x) >= 0 {
        bigint_mod(&bigint_sub(&lambda_squared, &two_x), &SECP256K1_P)
    } else {
        let diff = bigint_sub(&two_x, &lambda_squared);
        bigint_sub(&SECP256K1_P, &diff)
    };

    // y3 = lambda * (x - x3) - y mod p
    let x_diff = if bigint_cmp(&p.x, &x3) >= 0 {
        bigint_sub(&p.x, &x3)
    } else {
        let diff = bigint_sub(&x3, &p.x);
        bigint_sub(&SECP256K1_P, &diff)
    };
    let lambda_x_diff = bigint_mul_mod(&lambda, &x_diff, &SECP256K1_P);
    let y3 = if bigint_cmp(&lambda_x_diff, &p.y) >= 0 {
        bigint_mod(&bigint_sub(&lambda_x_diff, &p.y), &SECP256K1_P)
    } else {
        let diff = bigint_sub(&p.y, &lambda_x_diff);
        bigint_sub(&SECP256K1_P, &diff)
    };

    ECPoint { x: x3, y: y3 }
}

/// EC Point addition: result = P + Q
pub fn ec_add(p: &ECPoint, q: &ECPoint) -> ECPoint {
    if p.is_zero() {
        return *q;
    }
    if q.is_zero() {
        return *p;
    }
    if p.x == q.x {
        if p.y == q.y {
            return ec_double(p);
        } else {
            return ECPoint::default(); // Point at infinity
        }
    }

    // lambda = (y2 - y1) / (x2 - x1) mod p
    let y_diff = if bigint_cmp(&q.y, &p.y) >= 0 {
        bigint_sub(&q.y, &p.y)
    } else {
        let diff = bigint_sub(&p.y, &q.y);
        bigint_sub(&SECP256K1_P, &diff)
    };

    let x_diff = if bigint_cmp(&q.x, &p.x) >= 0 {
        bigint_sub(&q.x, &p.x)
    } else {
        let diff = bigint_sub(&p.x, &q.x);
        bigint_sub(&SECP256K1_P, &diff)
    };

    let x_diff_inv = match mod_inverse(&x_diff, &SECP256K1_P) {
        Some(inv) => inv,
        None => return ECPoint::default(),
    };
    let lambda = bigint_mul_mod(&y_diff, &x_diff_inv, &SECP256K1_P);

    // x3 = lambda^2 - x1 - x2 mod p
    let lambda_squared = bigint_mul_mod(&lambda, &lambda, &SECP256K1_P);
    let (sum_x, _) = bigint_add(&p.x, &q.x);
    let sum_x = bigint_mod(&sum_x, &SECP256K1_P);
    let x3 = if bigint_cmp(&lambda_squared, &sum_x) >= 0 {
        bigint_mod(&bigint_sub(&lambda_squared, &sum_x), &SECP256K1_P)
    } else {
        let diff = bigint_sub(&sum_x, &lambda_squared);
        bigint_sub(&SECP256K1_P, &diff)
    };

    // y3 = lambda * (x1 - x3) - y1 mod p
    let x1_minus_x3 = if bigint_cmp(&p.x, &x3) >= 0 {
        bigint_sub(&p.x, &x3)
    } else {
        let diff = bigint_sub(&x3, &p.x);
        bigint_sub(&SECP256K1_P, &diff)
    };
    let lambda_times = bigint_mul_mod(&lambda, &x1_minus_x3, &SECP256K1_P);
    let y3 = if bigint_cmp(&lambda_times, &p.y) >= 0 {
        bigint_mod(&bigint_sub(&lambda_times, &p.y), &SECP256K1_P)
    } else {
        let diff = bigint_sub(&p.y, &lambda_times);
        bigint_sub(&SECP256K1_P, &diff)
    };

    ECPoint { x: x3, y: y3 }
}

/// EC Point scalar multiplication: result = k * P
pub fn ec_mul(k: &[u8; 32], p: &ECPoint) -> ECPoint {
    let mut result = ECPoint::default();
    let mut temp = *p;

    for i in (0..32).rev() {
        for j in 0..8 {
            if (k[i] >> j) & 1 == 1 {
                result = ec_add(&result, &temp);
            }
            temp = ec_double(&temp);
        }
    }

    result
}

/// Get elliptic curve coordinates after applying inverse key
/// Matches Utils.sol getElipticCurveCoordinates function
/// Returns: (1/key) * Point
pub fn get_elliptic_curve_coordinates(
    key: &[u8; 32],
    n: &[u8; 32],
    point: &ECPoint,
) -> Option<ECPoint> {
    // scalar = inverse(key) mod n
    let scalar = mod_inverse(key, n)?;

    // result = scalar * point
    let result = ec_mul(&scalar, point);

    Some(result)
}

/// Convenience function using curve order n
pub fn decrypt_card(key: &[u8; 32], point: &ECPoint) -> Option<ECPoint> {
    get_elliptic_curve_coordinates(key, &SECP256K1_N, point)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mod_inverse() {
        // Simple test: 3^(-1) mod 7 = 5 (since 3 * 5 = 15 = 2*7 + 1)
        let mut a = [0u8; 32];
        a[31] = 3;
        let mut n = [0u8; 32];
        n[31] = 7;

        let inv = mod_inverse(&a, &n).unwrap();
        assert_eq!(inv[31], 5);
    }

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
}
