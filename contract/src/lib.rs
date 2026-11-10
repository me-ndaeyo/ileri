//! Ileri: invoices as NFTs on NEAR.
//!
//! Each invoice is one NFT plus one [`Invoice`] record. Money arrives through
//! `ft_on_transfer` and is routed to whoever holds the NFT at that moment, so selling an
//! invoice sells its future payments too. The contract is the only source of truth for
//! money and status.
//!
//! This file holds the state and the initializer. Behaviour lives in sibling modules,
//! each contributing its own `#[near] impl Contract` block.

// SCAFFOLDING, REMOVE BEFORE STEP 1 IS DONE.
// `errors.rs` is a complete registry of the contract's failure modes and `gas.rs` of its
// budgets, so both run ahead of the handlers that reference them while step 1 is in
// progress. Deleting this attribute is a step-1 exit criterion: anything still reported
// unused at that point is either a check that was never wired up or an error that should
// not exist.
#![allow(dead_code)]

mod admin;
mod errors;
mod gas;
mod guards;
mod lifecycle;
mod math;
mod nft;
mod storage;
mod types;

#[cfg(test)]
mod test_utils;

use near_contract_standards::non_fungible_token::NonFungibleToken;
use near_contract_standards::non_fungible_token::metadata::{
    NFT_METADATA_SPEC, NFTContractMetadata,
};
use near_sdk::borsh::BorshSerialize;
use near_sdk::store::{IterableMap, IterableSet, LazyOption, LookupMap, Vector};
use near_sdk::{AccountId, BorshStorageKey, PanicOnDefault, env, near};

pub use types::{Invoice, InvoiceView, Rep, Status, StatusView, TransferMsg};

#[derive(BorshSerialize, BorshStorageKey)]
#[borsh(crate = "near_sdk::borsh")]
enum StorageKey {
    Invoices,
    ByIssuer,
    ByIssuerInner { account_hash: Vec<u8> },
    ByClient,
    ByClientInner { account_hash: Vec<u8> },
    Reputation,
    VolumePaid,
    Claimable,
    Listed,
    AllowedTokens,
    NftOwnerById,
    NftTokenMetadata,
    NftTokensPerOwner,
    NftContractMetadata,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    /// May only edit the payment-token allowlist. No admin path to money or invoices.
    pub(crate) owner_id: AccountId,

    /// NEP-171 bookkeeping. Built with no approval prefix, which is how NEP-178 is
    /// disabled: structurally, rather than by a runtime check that could be forgotten.
    pub(crate) nft: NonFungibleToken,
    pub(crate) nft_metadata: LazyOption<NFTContractMetadata>,

    pub(crate) invoices: IterableMap<u64, Invoice>,

    /// Append-only indexes. Closing an invoice removes it from `invoices` but leaves its
    /// id here, so ordering is stable and views simply skip ids that no longer resolve.
    pub(crate) by_issuer: LookupMap<AccountId, Vector<u64>>,
    pub(crate) by_client: LookupMap<AccountId, Vector<u64>>,

    /// Declared now, wired in build step 2, so step 2 needs no state migration.
    pub(crate) reputation: LookupMap<AccountId, Rep>,
    /// Keyed by (client, token).
    pub(crate) volume_paid: LookupMap<(AccountId, AccountId), u128>,
    /// Keyed by (holder, token). Payouts that could not be pushed.
    pub(crate) claimable: LookupMap<(AccountId, AccountId), u128>,
    /// Declared now, wired in build step 2.
    pub(crate) listed: IterableSet<u64>,

    pub(crate) allowed_tokens: IterableSet<AccountId>,
    pub(crate) next_id: u64,
}

#[near]
impl Contract {
    /// `metadata` stays generic on purpose: no names, no amounts, nothing private, since
    /// wallets and explorers display it to anyone.
    #[init]
    pub fn init(
        owner_id: AccountId,
        allowed_tokens: Vec<AccountId>,
        metadata: Option<NFTContractMetadata>,
    ) -> Self {
        let metadata = metadata.unwrap_or_else(|| NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "Ileri invoices".to_string(),
            symbol: "ILERI".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        });
        metadata.assert_valid();

        let mut tokens = IterableSet::new(StorageKey::AllowedTokens);
        for token in allowed_tokens {
            tokens.insert(token);
        }

        Self {
            owner_id: owner_id.clone(),
            nft: NonFungibleToken::new(
                StorageKey::NftOwnerById,
                owner_id,
                Some(StorageKey::NftTokenMetadata),
                Some(StorageKey::NftTokensPerOwner),
                // No approval prefix: NEP-178 is disabled by construction.
                Option::<StorageKey>::None,
            ),
            nft_metadata: LazyOption::new(StorageKey::NftContractMetadata, Some(metadata)),
            invoices: IterableMap::new(StorageKey::Invoices),
            by_issuer: LookupMap::new(StorageKey::ByIssuer),
            by_client: LookupMap::new(StorageKey::ByClient),
            reputation: LookupMap::new(StorageKey::Reputation),
            volume_paid: LookupMap::new(StorageKey::VolumePaid),
            claimable: LookupMap::new(StorageKey::Claimable),
            listed: IterableSet::new(StorageKey::Listed),
            allowed_tokens: tokens,
            next_id: 1,
        }
    }

    pub fn get_owner_id(&self) -> AccountId {
        self.owner_id.clone()
    }

    /// The id the next `create_invoice` will mint.
    pub fn get_next_invoice_id(&self) -> near_sdk::json_types::U64 {
        self.next_id.into()
    }
}

impl Contract {
    /// Per-account prefix for an inner `Vector`. Hashing the account id keeps the prefix
    /// fixed-length, so two account ids can never produce overlapping key ranges.
    pub(crate) fn issuer_index_key(account: &AccountId) -> StorageKey {
        StorageKey::ByIssuerInner {
            account_hash: env::sha256(account.as_bytes()),
        }
    }

    pub(crate) fn client_index_key(account: &AccountId) -> StorageKey {
        StorageKey::ByClientInner {
            account_hash: env::sha256(account.as_bytes()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;
    use near_contract_standards::non_fungible_token::NonFungibleTokenEnumeration;
    use near_sdk::IntoStorageKey;

    #[test]
    fn init_sets_state() {
        let contract = setup(OWNER);
        assert_eq!(contract.get_owner_id(), acc(OWNER));
        // Ids start at 1, so 0 is never a valid invoice id.
        assert_eq!(contract.get_next_invoice_id(), 1.into());
        assert_eq!(contract.invoices.len(), 0);
        assert_eq!(contract.nft.nft_total_supply(), 0.into());
    }

    #[test]
    fn default_nft_metadata_is_generic() {
        let contract = setup(OWNER);
        let metadata = contract.nft_metadata.get().clone().unwrap();
        assert_eq!(metadata.spec, NFT_METADATA_SPEC);
        assert_eq!(metadata.symbol, "ILERI");
        // Nothing private may reach onchain metadata.
        assert!(metadata.reference.is_none());
        assert!(metadata.base_uri.is_none());
    }

    #[test]
    fn index_prefixes_are_fixed_length_and_distinct() {
        // A short and a long account id must yield equal-length prefixes, so no two
        // accounts can produce overlapping storage key ranges.
        let short = Contract::issuer_index_key(&acc("a.near"));
        let long = Contract::issuer_index_key(&acc(STRANGER));
        let short_key: Vec<u8> = short.into_storage_key();
        let long_key: Vec<u8> = long.into_storage_key();
        assert_eq!(short_key.len(), long_key.len());
        assert_ne!(short_key, long_key);

        // Issuer and client indexes must not collide for the same account.
        let issuer_key: Vec<u8> = Contract::issuer_index_key(&acc(ISSUER)).into_storage_key();
        let client_key: Vec<u8> = Contract::client_index_key(&acc(ISSUER)).into_storage_key();
        assert_ne!(issuer_key, client_key);
    }
}
