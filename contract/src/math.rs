//! Checked arithmetic for money. Every `u128` operation on an amount goes through here.
//!
//! `overflow-checks = true` in the release profile already traps on overflow, but these
//! give a named error instead of an opaque arithmetic panic, and they make money math
//! grep-able: a bare `+` or `-` on an amount is a review finding.

use crate::errors::{E_OVERFLOW, E_UNDERFLOW};
use near_sdk::env;

pub fn add(a: u128, b: u128) -> u128 {
    match a.checked_add(b) {
        Some(v) => v,
        None => env::panic_str(E_OVERFLOW),
    }
}

pub fn sub(a: u128, b: u128) -> u128 {
    match a.checked_sub(b) {
        Some(v) => v,
        None => env::panic_str(E_UNDERFLOW),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_and_sub_work() {
        assert_eq!(add(2, 3), 5);
        assert_eq!(sub(5, 3), 2);
        assert_eq!(sub(5, 5), 0);
    }

    #[test]
    #[should_panic(expected = "E_OVERFLOW")]
    fn add_overflow_panics() {
        add(u128::MAX, 1);
    }

    #[test]
    #[should_panic(expected = "E_UNDERFLOW")]
    fn sub_underflow_panics() {
        sub(0, 1);
    }
}
