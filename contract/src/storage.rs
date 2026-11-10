//! Storage accounting for mint and close.
//!
//! The issuer pays for the bytes their invoice occupies and gets them back when the
//! invoice is closed. The amount is measured, never estimated, so a change to the
//! `Invoice` struct cannot silently under-charge.

use near_sdk::{NearToken, Promise, StorageUsage, env};

use crate::errors::E_DEPOSIT_TOO_SMALL;
use crate::guards::caller;

/// Measures how many bytes of storage a block of work consumed.
pub(crate) struct StorageMeter {
    start: StorageUsage,
}

impl StorageMeter {
    pub(crate) fn start() -> Self {
        Self {
            start: env::storage_usage(),
        }
    }

    /// Bytes written since [`start`](Self::start). Saturating, so a net *decrease* reads
    /// as zero rather than underflowing.
    pub(crate) fn bytes(&self) -> StorageUsage {
        env::storage_usage().saturating_sub(self.start)
    }

    /// What those bytes cost in yocto at the current storage price.
    pub(crate) fn cost(&self) -> u128 {
        cost_of(self.bytes())
    }
}

pub(crate) fn cost_of(bytes: StorageUsage) -> u128 {
    env::storage_byte_cost()
        .as_yoctonear()
        .saturating_mul(bytes as u128)
}

/// Require the attached deposit to cover `required` yocto, and return any surplus to the
/// caller.
///
/// Refunding here rather than keeping the remainder means an issuer who over-attaches is
/// never quietly out of pocket.
pub(crate) fn charge_and_refund(required: u128) {
    let attached = env::attached_deposit().as_yoctonear();
    if attached < required {
        env::panic_str(E_DEPOSIT_TOO_SMALL);
    }
    let surplus = attached - required;
    if surplus > 0 {
        Promise::new(caller())
            .transfer(NearToken::from_yoctonear(surplus))
            .detach();
    }
}
