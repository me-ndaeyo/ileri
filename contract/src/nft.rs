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
//! Transfers are gated on invoice state rather than being freely allowed. An invoice may
//! only change hands once the client has accepted it and before it is fully paid: before
//! acceptance there is no agreed obligation for a buyer to rely on, and after settlement
//! there is nothing left to buy. Any transfer clears a standing listing, so a sale price
//! set by the old holder can never bind the new one.

use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::core::{
    NonFungibleTokenResolver, ext_nft_receiver,
};
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::{NftBurn, NftMint, NftTransfer};
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata,
};
use near_contract_standards::non_fungible_token::{Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::{AccountId, PromiseOrValue, assert_one_yocto, env, near};
use std::collections::HashMap;

use crate::errors::{E_NOT_HOLDER, E_NOT_TRADABLE};
use crate::gas::{GAS_NFT_ON_TRANSFER, GAS_NFT_RESOLVE_TRANSFER};
use crate::guards::caller;
use crate::{Contract, ContractExt};

#[near]
impl NonFungibleTokenCore for Contract {
    /// Hand an invoice to another account.
    ///
    /// `approval_id` is ignored because NEP-178 is not implemented: there is no approval
    /// storage, so no third party can ever be authorised to move an invoice.
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        _approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        // NEP-171 requires 1 yocto, which forces a full-access-key signature and so
        // cannot be done by a restricted function-call key.
        assert_one_yocto();
        let sender = caller();
        let id = self.assert_transferable(&token_id, &sender);
        self.move_invoice_nft(id, &token_id, &sender, &receiver_id, memo);
    }

    /// Transfer and then notify the receiving contract, per NEP-171.
    ///
    /// If the receiver's `nft_on_transfer` asks for the token back, or the call fails,
    /// `nft_resolve_transfer` returns it.
    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        _approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        assert_one_yocto();
        let sender = caller();
        let id = self.assert_transferable(&token_id, &sender);
        self.move_invoice_nft(id, &token_id, &sender, &receiver_id, memo);

        ext_nft_receiver::ext(receiver_id.clone())
            .with_static_gas(GAS_NFT_ON_TRANSFER)
            .nft_on_transfer(sender.clone(), sender.clone(), token_id.clone(), msg)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_NFT_RESOLVE_TRANSFER)
                    .nft_resolve_transfer(sender, receiver_id, token_id, None),
            )
            .into()
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.nft.nft_token(token_id)
    }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    /// Give the invoice back if the receiver refused it or the call failed.
    ///
    /// `approved_account_ids` is always `None` here: approvals do not exist, so there is
    /// nothing to restore on a revert.
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        _approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        let return_it = match env::promise_result_checked(0, 8) {
            // The receiver said "give it back".
            Ok(value) => near_sdk::serde_json::from_slice::<bool>(&value).unwrap_or(false),
            // A failed receiver must not be able to swallow an invoice.
            Err(_) => true,
        };

        if !return_it {
            return true;
        }

        // The owner may have moved on again inside the receiver's call. If so, leave it
        // alone rather than yanking it away from a third party.
        if self.nft.owner_by_id.get(&token_id).as_ref() != Some(&receiver_id) {
            return true;
        }

        let Some(id) = Self::invoice_id_of(&token_id) else {
            return true;
        };
        self.move_invoice_nft(
            id,
            &token_id,
            &receiver_id,
            &previous_owner_id,
            Some("returned by receiver".to_string()),
        );
        false
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

    pub(crate) fn invoice_id_of(token_id: &TokenId) -> Option<u64> {
        token_id.parse().ok()
    }

    /// Panic unless `sender` holds this token and its invoice may change hands.
    /// Returns the invoice id.
    pub(crate) fn assert_transferable(&self, token_id: &TokenId, sender: &AccountId) -> u64 {
        if self.nft.owner_by_id.get(token_id).as_ref() != Some(sender) {
            env::panic_str(E_NOT_HOLDER);
        }
        let Some(id) = Self::invoice_id_of(token_id) else {
            env::panic_str(E_NOT_HOLDER)
        };
        if !self.require_invoice(id).is_tradable() {
            env::panic_str(E_NOT_TRADABLE);
        }
        id
    }

    /// Move an invoice's NFT, clearing any listing and emitting NEP-171.
    ///
    /// Clearing the listing on every move is what stops a price set by the old holder
    /// binding the new one.
    pub(crate) fn move_invoice_nft(
        &mut self,
        id: u64,
        token_id: &TokenId,
        from: &AccountId,
        to: &AccountId,
        memo: Option<String>,
    ) {
        self.clear_listing(id);
        self.nft.internal_transfer_unguarded(token_id, from, to);

        NftTransfer {
            old_owner_id: from.as_ref(),
            new_owner_id: to.as_ref(),
            token_ids: &[token_id],
            authorized_id: None,
            memo: memo.as_deref(),
        }
        .emit();
    }

    /// Drop a listing if there is one, silently.
    ///
    /// No `invoice_unlisted` event: when this runs as part of a transfer or a settlement,
    /// the transfer or payment event already explains why the listing is gone, and a
    /// second event would double-count in an indexer.
    pub(crate) fn clear_listing(&mut self, id: u64) {
        self.listed.remove(&id);
        if let Some(invoice) = self.invoices.get_mut(&id) {
            invoice.listing = None;
        }
    }

    /// Whoever holds the NFT right now, and therefore whoever the next payment goes to.
    pub(crate) fn holder_of(&self, id: u64) -> Option<AccountId> {
        self.nft.owner_by_id.get(&Self::token_id_of(id))
    }

    /// Token metadata is deliberately minimal: a title, and an image of the instrument.
    ///
    /// Wallets and explorers show this to anyone, so it carries no client name, no
    /// amount, no due date and no reference to the invoice file.
    ///
    /// `media` is a relative path, joined by the viewer with `base_uri` from
    /// `nft_metadata`. Relative rather than absolute because the contract has no business
    /// knowing a hostname, and because `base_uri` already exists in stored state while a
    /// new field on the contract struct would need a migration to redeploy over.
    ///
    /// The convention it is built for is `{base_uri}/{media}`, which is what wallets and
    /// marketplaces do, so `base_uri` is set WITHOUT a trailing slash and this WITHOUT a
    /// leading one.
    ///
    /// The image itself is generated from the token id alone and carries the wordmark,
    /// the serial, the contract id and the status. That keeps the privacy rule intact:
    /// there is nothing in a serial that a reader could not already see on chain.
    fn invoice_token_metadata(id: u64) -> TokenMetadata {
        TokenMetadata {
            title: Some(format!("Invoice #{id}")),
            description: None,
            media: Some(format!("{id}/image.svg")),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;
    use crate::types::Status;

    const AMOUNT: u128 = 1_200_000_000;

    fn transfer(contract: &mut Contract, id: u64, from: &str, to: &str) {
        set_context_with_deposit(from, one_yocto());
        contract.nft_transfer(acc(to), Contract::token_id_of(id), None, None);
    }

    // --- the guard: who, and in which states ---

    #[test]
    fn the_holder_can_hand_on_an_accepted_invoice() {
        let (mut contract, id) = with_tradable_invoice(AMOUNT);
        transfer(&mut contract, id, ISSUER, STRANGER);

        assert_eq!(contract.holder_of(id), Some(acc(STRANGER)));
        // The issuer stays the issuer; only the holder changed.
        assert_eq!(contract.require_invoice(id).issuer, acc(ISSUER));
        assert_eq!(
            contract
                .nft_tokens_for_owner(acc(STRANGER), None, None)
                .len(),
            1
        );
        assert!(
            contract
                .nft_tokens_for_owner(acc(ISSUER), None, None)
                .is_empty(),
            "the old owner's index entry must be dropped"
        );
    }

    #[test]
    fn a_part_paid_invoice_is_still_tradable() {
        // This is the interesting case commercially: a buyer takes on what is still owed.
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::PartiallyPaid, 400_000_000);
        transfer(&mut contract, id, ISSUER, STRANGER);
        assert_eq!(contract.holder_of(id), Some(acc(STRANGER)));
    }

    #[test]
    #[should_panic(expected = "E_NOT_HOLDER")]
    fn a_non_holder_cannot_transfer() {
        let (mut contract, id) = with_tradable_invoice(AMOUNT);
        transfer(&mut contract, id, STRANGER, CLIENT);
    }

    #[test]
    #[should_panic(expected = "E_NOT_TRADABLE")]
    fn a_fully_paid_invoice_cannot_be_transferred() {
        // There is nothing left to buy.
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Paid, AMOUNT);
        transfer(&mut contract, id, ISSUER, STRANGER);
    }

    #[test]
    #[should_panic(expected = "E_NOT_TRADABLE")]
    fn a_rejected_invoice_cannot_be_transferred() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Rejected, 0);
        transfer(&mut contract, id, ISSUER, STRANGER);
    }

    #[test]
    #[should_panic(expected = "E_NOT_TRADABLE")]
    fn a_cancelled_invoice_cannot_be_transferred() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Cancelled, 0);
        transfer(&mut contract, id, ISSUER, STRANGER);
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn transferring_requires_one_yocto() {
        // NEP-171 asks for this so a transfer needs a full-access-key signature and
        // cannot be made by a restricted function-call key.
        let (mut contract, id) = with_tradable_invoice(AMOUNT);
        set_context(ISSUER);
        contract.nft_transfer(acc(STRANGER), Contract::token_id_of(id), None, None);
    }

    #[test]
    fn transferring_emits_nep171() {
        let (mut contract, id) = with_tradable_invoice(AMOUNT);
        transfer(&mut contract, id, ISSUER, STRANGER);

        let event = nft_transfer_events()
            .pop()
            .expect("nft_transfer must be emitted");
        assert_eq!(event["data"][0]["old_owner_id"], "issuer.near");
        assert_eq!(event["data"][0]["new_owner_id"], "stranger.near");
        assert_eq!(event["data"][0]["token_ids"][0], "1");
    }

    #[test]
    fn transferring_clears_any_listing() {
        // Otherwise a price set by the old holder would bind the new one.
        let (mut contract, id) = with_tradable_invoice(AMOUNT);
        set_context(ISSUER);
        contract.list_invoice(id.into(), 900_000_000.into());
        assert!(contract.require_invoice(id).listing.is_some());

        transfer(&mut contract, id, ISSUER, STRANGER);

        assert_eq!(contract.require_invoice(id).listing, None);
        assert!(!contract.listed.contains(&id));
        assert!(contract.get_listings(None, None).is_empty());
    }

    #[test]
    #[should_panic(expected = "E_NOT_HOLDER")]
    fn an_unknown_token_cannot_be_transferred() {
        let (mut contract, _id) = with_tradable_invoice(AMOUNT);
        set_context_with_deposit(ISSUER, one_yocto());
        contract.nft_transfer(acc(STRANGER), "nonexistent".to_string(), None, None);
    }

    // --- nft_resolve_transfer: a receiver must not be able to swallow an invoice ---

    #[test]
    fn a_receiver_that_accepts_keeps_the_invoice() {
        let (mut contract, id) = with_tradable_invoice(AMOUNT);
        transfer(&mut contract, id, ISSUER, STRANGER);

        // `false` from nft_on_transfer means "I am keeping it".
        set_callback_context(near_sdk::PromiseResult::Successful(b"false".to_vec()));
        let kept = contract.nft_resolve_transfer(
            acc(ISSUER),
            acc(STRANGER),
            Contract::token_id_of(id),
            None,
        );
        assert!(kept);
        assert_eq!(contract.holder_of(id), Some(acc(STRANGER)));
    }

    #[test]
    fn a_receiver_that_refuses_gets_the_invoice_taken_back() {
        let (mut contract, id) = with_tradable_invoice(AMOUNT);
        transfer(&mut contract, id, ISSUER, STRANGER);

        set_callback_context(near_sdk::PromiseResult::Successful(b"true".to_vec()));
        let kept = contract.nft_resolve_transfer(
            acc(ISSUER),
            acc(STRANGER),
            Contract::token_id_of(id),
            None,
        );
        assert!(!kept);
        assert_eq!(
            contract.holder_of(id),
            Some(acc(ISSUER)),
            "it must go back to the sender"
        );
    }

    #[test]
    fn a_failed_receiver_cannot_swallow_an_invoice() {
        let (mut contract, id) = with_tradable_invoice(AMOUNT);
        transfer(&mut contract, id, ISSUER, STRANGER);

        set_callback_context(near_sdk::PromiseResult::Failed);
        let kept = contract.nft_resolve_transfer(
            acc(ISSUER),
            acc(STRANGER),
            Contract::token_id_of(id),
            None,
        );
        assert!(!kept);
        assert_eq!(contract.holder_of(id), Some(acc(ISSUER)));
    }

    #[test]
    fn a_revert_does_not_yank_the_invoice_from_a_third_party() {
        // If the receiver passed it on during its own call, the invoice is no longer
        // theirs to give back and must be left where it is.
        let (mut contract, id) = with_tradable_invoice(AMOUNT);
        transfer(&mut contract, id, ISSUER, STRANGER);
        transfer(&mut contract, id, STRANGER, CLIENT);

        set_callback_context(near_sdk::PromiseResult::Failed);
        let kept = contract.nft_resolve_transfer(
            acc(ISSUER),
            acc(STRANGER),
            Contract::token_id_of(id),
            None,
        );
        assert!(kept);
        assert_eq!(contract.holder_of(id), Some(acc(CLIENT)));
    }
}
