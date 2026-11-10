//! NEP-171 core, NEP-177 metadata and NEP-181 enumeration, implemented by hand.
//!
//! Hand-written for two reasons. The standard's `impl_non_fungible_token_*!` macros are
//! deprecated upstream in favour of implementing the traits directly, and Ileri needs
//! transfers guarded by invoice state, which a generated passthrough cannot express.
//!
//! NEP-178 approvals are never implemented. The contract is built with no approval
//! prefix, so there is no approval storage to write to: no third party can ever move an
//! invoice, enforced by construction rather than by a check that could be forgotten.
//!
//! In build step 1 transfers panic. That is the safe default: an invoice cannot leave its
//! issuer until step 2 adds the real accepted-and-not-paid guard.

use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::{NftBurn, NftMint};
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata,
};
use near_contract_standards::non_fungible_token::{Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::{AccountId, PromiseOrValue, env, near};

use crate::errors::E_TRANSFER_NOT_ALLOWED;
use crate::{Contract, ContractExt};

#[near]
impl NonFungibleTokenCore for Contract {
    /// Blocked in step 1. Step 2 allows it only while the invoice is accepted and not yet
    /// fully paid, and clears any listing on the way through.
    #[payable]
    fn nft_transfer(
        &mut self,
        _receiver_id: AccountId,
        _token_id: TokenId,
        _approval_id: Option<u64>,
        _memo: Option<String>,
    ) {
        env::panic_str(E_TRANSFER_NOT_ALLOWED)
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        _receiver_id: AccountId,
        _token_id: TokenId,
        _approval_id: Option<u64>,
        _memo: Option<String>,
        _msg: String,
    ) -> PromiseOrValue<bool> {
        env::panic_str(E_TRANSFER_NOT_ALLOWED)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.nft.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 {
        self.nft.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.nft.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.nft.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.nft.nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    /// NEP-177 requires a non-optional return, so this cannot follow the usual
    /// "views return Option" rule. The value is set in `init` and never cleared, and
    /// `PanicOnDefault` guarantees `init` ran, so the invariant holds; `expect` states it
    /// rather than leaving a bare unwrap to be read as an oversight.
    fn nft_metadata(&self) -> NFTContractMetadata {
        self.nft_metadata
            .get()
            .clone()
            .expect("nft metadata is set by init and never cleared")
    }
}

impl Contract {
    /// An invoice's NFT `token_id` is its id as a decimal string, so the two are always
    /// trivially derivable from each other.
    pub(crate) fn token_id_of(id: u64) -> TokenId {
        id.to_string()
    }

    /// Whoever holds the NFT right now, and therefore whoever the next payment goes to.
    pub(crate) fn holder_of(&self, id: u64) -> Option<AccountId> {
        self.nft.owner_by_id.get(&Self::token_id_of(id))
    }

    /// Token metadata is deliberately minimal: a title and nothing else.
    ///
    /// Wallets and explorers show this to anyone, so it carries no client name, no
    /// amount, no due date and no reference to the invoice file.
    fn invoice_token_metadata(id: u64) -> TokenMetadata {
        TokenMetadata {
            title: Some(format!("Invoice #{id}")),
            description: None,
            media: None,
            media_hash: None,
            copies: Some(1),
            issued_at: None,
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: None,
            reference: None,
            reference_hash: None,
        }
    }

    /// Mint the NFT for an invoice.
    ///
    /// Uses `refund_id: None` so the standard does not refund storage on its own: the
    /// caller measures the invoice record and the NFT together and refunds once. That
    /// variant also emits no event, so the NEP-171 `nft_mint` is emitted here explicitly.
    pub(crate) fn mint_invoice_nft(&mut self, id: u64, owner: &AccountId) -> Token {
        let token_id = Self::token_id_of(id);
        let token = self.nft.internal_mint_with_refund(
            token_id.clone(),
            owner.clone(),
            Some(Self::invoice_token_metadata(id)),
            None,
        );
        NftMint {
            owner_id: owner.as_ref(),
            token_ids: &[&token_id],
            memo: None,
        }
        .emit();
        token
    }

    /// Burn an invoice's NFT.
    ///
    /// Written by hand because `near-contract-standards` offers no `internal_burn`. This
    /// mirrors `internal_transfer_unguarded`'s bookkeeping in reverse: drop the owner
    /// record, the token metadata and the per-owner index entry, removing the per-owner
    /// set entirely once it is empty so no empty collection is left paying for storage.
    pub(crate) fn burn_invoice_nft(&mut self, id: u64, owner: &AccountId) {
        let token_id = Self::token_id_of(id);

        self.nft.owner_by_id.remove(&token_id);

        if let Some(by_id) = &mut self.nft.token_metadata_by_id {
            by_id.remove(&token_id);
        }

        if let Some(tokens_per_owner) = &mut self.nft.tokens_per_owner
            && let Some(mut owned) = tokens_per_owner.get(owner)
        {
            owned.remove(&token_id);
            if owned.is_empty() {
                tokens_per_owner.remove(owner);
            } else {
                tokens_per_owner.insert(owner, &owned);
            }
        }

        NftBurn {
            owner_id: owner.as_ref(),
            token_ids: &[&token_id],
            authorized_id: None,
            memo: None,
        }
        .emit();
    }
}
