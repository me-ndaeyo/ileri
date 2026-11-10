//! Ileri: invoices as NFTs on NEAR.
//!
//! Each invoice is one NFT plus one `Invoice` record. Payments arrive through
//! `ft_on_transfer` and are routed to whoever holds the NFT at that moment, so selling an
//! invoice also sells its future payments.
//!
//! This file is the contract state and its initializer. Behaviour lives in sibling modules,
//! each with its own `#[near] impl Contract` block.

use near_sdk::{AccountId, PanicOnDefault, near};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    /// May only edit the payment-token allowlist. There is no admin path to move funds or
    /// invoices.
    owner_id: AccountId,
}

#[near]
impl Contract {
    #[init]
    pub fn init(owner_id: AccountId) -> Self {
        Self { owner_id }
    }

    pub fn get_owner_id(&self) -> AccountId {
        self.owner_id.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    #[test]
    fn init_sets_owner() {
        let contract = Contract::init(account("owner.near"));
        assert_eq!(contract.get_owner_id(), account("owner.near"));
    }
}
