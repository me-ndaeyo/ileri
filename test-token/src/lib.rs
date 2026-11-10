//! A minimal NEP-141 token, for tests only.
//!
//! Ileri's sandbox tests need a real token contract to prove the `ft_transfer_call` round
//! trip works against a genuine counterparty rather than a mock. This is that
//! counterparty, and it is also what the testnet walkthrough uses as stand-in USDC.
//!
//! It is deliberately boring: the standard `FungibleToken` from
//! `near-contract-standards`, six decimals to match USDC, plus an unguarded `mint` so a
//! test can fund accounts in one call. **The open mint is why this must never be deployed
//! anywhere that matters.**
//!
//! NEP-145 storage management is implemented because Ileri depends on it in two places:
//! `create_invoice` registers the issuer so the first payout can be pushed, and an
//! unregistered holder is exactly how a payout is made to fail so the `claimable`
//! fallback can be tested.

use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::metadata::{
    FT_METADATA_SPEC, FungibleTokenMetadata, FungibleTokenMetadataProvider,
};
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{AccountId, NearToken, PanicOnDefault, PromiseOrValue, near};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    metadata: FungibleTokenMetadata,
}

#[near]
impl Contract {
    #[init]
    pub fn new(symbol: String, decimals: u8) -> Self {
        Self {
            token: FungibleToken::new(b"t".to_vec()),
            metadata: FungibleTokenMetadata {
                spec: FT_METADATA_SPEC.to_string(),
                name: format!("Ileri test {symbol}"),
                symbol,
                icon: None,
                reference: None,
                reference_hash: None,
                decimals,
            },
        }
    }

    /// Six decimals, matching USDC, so test amounts read the same as production ones.
    #[init]
    pub fn new_usdc() -> Self {
        Self::new("USDC".to_string(), 6)
    }

    /// Unguarded on purpose. Tests need to fund accounts without a faucet dance.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        if self.token.accounts.get(&account_id).is_none() {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount.0);
    }
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo);
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.token
            .ft_resolve_transfer(sender_id, receiver_id, amount)
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.storage_unregister(force)
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }
}
