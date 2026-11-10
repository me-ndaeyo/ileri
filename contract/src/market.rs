//! The marketplace: selling an invoice before it is paid (factoring).
//!
//! The sale happens inside this contract in one atomic step. The buyer sends the price
//! with `ft_transfer_call`, and in the same receipt the NFT moves and the seller is paid.
//! There is no external marketplace and no approvals to manage, so there is no window in
//! which a buyer has paid but does not yet hold the invoice.
//!
//! Once an invoice changes hands, every later payment on it goes to the new holder. That
//! is the whole product: a buyer is purchasing the future payments, at a discount that
//! prices the risk the client never pays.

use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, near};

use crate::errors::{
    E_ALREADY_LISTED, E_NOT_LISTED, E_NOT_TRADABLE, E_PRICE_TOO_HIGH, E_PRICE_ZERO,
};
use crate::events::Event;
use crate::guards::caller;
use crate::types::{InvoiceView, Rep};
use crate::{Contract, ContractExt};
use near_sdk::env;

/// What a buyer needs in order to price the risk, in one object.
#[near(serializers = [json])]
pub struct ListingView {
    pub invoice: InvoiceView,
    pub price: U128,
    /// What is still owed on the invoice. The buyer collects this, not `price`.
    pub unpaid: U128,
    /// `unpaid - price`: the buyer's gross upside if the client pays in full.
    pub discount: U128,
    /// Whole days from now until the due date, `0` if already past.
    pub days_to_due: u64,
    /// The bound client's record, or `None` if the invoice was never accepted by a
    /// signed-in client. `None` is itself a signal: there is no payment history to go on.
    pub client_reputation: Option<Rep>,
}

#[near]
impl Contract {
    /// Offer an invoice for sale at `price`, in the invoice's own token.
    ///
    /// The price must sit below the unpaid balance. A price at or above it would mean
    /// paying more than the invoice can ever return, so nobody should buy it and allowing
    /// it would only create a trap.
    pub fn list_invoice(&mut self, id: U64, price: U128) {
        let id = id.0;
        let mut invoice = self.require_invoice(id);

        self.assert_holder(id);
        if !invoice.is_tradable() {
            env::panic_str(E_NOT_TRADABLE);
        }
        if invoice.listing.is_some() {
            env::panic_str(E_ALREADY_LISTED);
        }
        if price.0 == 0 {
            env::panic_str(E_PRICE_ZERO);
        }
        if price.0 >= invoice.unpaid() {
            env::panic_str(E_PRICE_TOO_HIGH);
        }

        invoice.listing = Some(price.0);
        self.invoices.insert(id, invoice);
        self.listed.insert(id);

        Event::InvoiceListed {
            invoice_id: id.into(),
            seller: caller(),
            price,
        }
        .emit();
    }

    /// Withdraw an invoice from sale.
    pub fn unlist_invoice(&mut self, id: U64) {
        let id = id.0;
        let invoice = self.require_invoice(id);

        self.assert_holder(id);
        if invoice.listing.is_none() {
            env::panic_str(E_NOT_LISTED);
        }

        self.clear_listing(id);

        Event::InvoiceUnlisted {
            invoice_id: id.into(),
            seller: caller(),
        }
        .emit();
    }

    /// Invoices currently for sale, oldest listing first.
    pub fn get_listings(&self, from_index: Option<U64>, limit: Option<u64>) -> Vec<ListingView> {
        let from = from_index.map(|from| from.0).unwrap_or(0);
        let limit = limit.unwrap_or(50).min(200);

        self.listed
            .iter()
            .skip(from as usize)
            .take(limit as usize)
            .filter_map(|id| self.listing_view(*id))
            .collect()
    }

    pub fn get_listing(&self, id: U64) -> Option<ListingView> {
        self.listing_view(id.0)
    }
}

impl Contract {
    fn listing_view(&self, id: u64) -> Option<ListingView> {
        let invoice = self.invoices.get(&id)?;
        let price = invoice.listing?;
        let unpaid = invoice.unpaid();
        let now = env::block_timestamp();

        Some(ListingView {
            price: U128(price),
            unpaid: U128(unpaid),
            // Saturating: a listing can never show a negative upside even if the unpaid
            // balance fell below the price after a part payment.
            discount: U128(unpaid.saturating_sub(price)),
            days_to_due: invoice
                .due_date
                .saturating_sub(now)
                .saturating_div(86_400 * 1_000_000_000),
            client_reputation: invoice
                .client
                .as_ref()
                .map(|client| self.get_reputation(client.clone())),
            invoice: self.get_invoice(id.into())?,
        })
    }

    /// Settle a purchase: move the invoice to the buyer and pay the seller.
    ///
    /// Returns `(seller, price, excess)`. State is fully committed before the caller
    /// schedules the payout, so a late callback can never read a stale holder.
    pub(crate) fn settle_purchase(
        &mut self,
        id: u64,
        buyer: &AccountId,
        token: &AccountId,
        amount: u128,
    ) -> Option<(AccountId, u128, u128)> {
        let invoice = self.invoices.get(&id)?;
        if &invoice.token != token {
            return None;
        }
        let price = invoice.listing?;
        if !invoice.is_tradable() {
            return None;
        }
        if amount < price {
            return None;
        }

        let seller = self.holder_of(id)?;
        // Buying your own listing would be a no-op that still moved money through the
        // payout path, so it is refused outright.
        if &seller == buyer {
            return None;
        }

        let excess = crate::math::sub(amount, price);
        let token_id = Self::token_id_of(id);
        // `move_invoice_nft` clears the listing and emits NEP-171 nft_transfer.
        self.move_invoice_nft(
            id,
            &token_id,
            &seller,
            buyer,
            Some(format!("ileri invoice {id} sold")),
        );

        Event::InvoiceSold {
            invoice_id: id.into(),
            seller: seller.clone(),
            buyer: buyer.clone(),
            price: U128(price),
        }
        .emit();

        Some((seller, price, excess))
    }
}

#[cfg(test)]
mod tests {
    use crate::test_utils::*;
    use crate::types::Status;
    use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;

    const AMOUNT: u128 = 1_200_000_000;
    const PRICE: u128 = 1_000_000_000;

    fn buy_msg(id: u64) -> String {
        format!(r#"{{"action":"buy","invoice_id":"{id}"}}"#)
    }

    fn listed(amount: u128, price: u128) -> (crate::Contract, u64) {
        let (mut contract, id) = with_tradable_invoice(amount);
        set_context(ISSUER);
        contract.list_invoice(id.into(), price.into());
        (contract, id)
    }

    // --- listing ---

    #[test]
    fn the_holder_can_list_and_unlist() {
        let (mut contract, id) = listed(AMOUNT, PRICE);
        assert_eq!(contract.require_invoice(id).listing, Some(PRICE));
        assert!(contract.listed.contains(&id));

        let event = ileri_event("invoice_listed").expect("invoice_listed");
        assert_eq!(event["data"]["seller"], "issuer.near");
        assert_eq!(event["data"]["price"], PRICE.to_string());

        set_context(ISSUER);
        contract.unlist_invoice(id.into());
        assert_eq!(contract.require_invoice(id).listing, None);
        assert!(!contract.listed.contains(&id));
        assert!(ileri_event("invoice_unlisted").is_some());
    }

    #[test]
    #[should_panic(expected = "E_NOT_HOLDER")]
    fn a_non_holder_cannot_list() {
        let (mut contract, id) = with_tradable_invoice(AMOUNT);
        set_context(STRANGER);
        contract.list_invoice(id.into(), PRICE.into());
    }

    #[test]
    #[should_panic(expected = "E_NOT_TRADABLE")]
    fn an_unaccepted_invoice_cannot_be_listed() {
        let (mut contract, id) = with_invoice(AMOUNT);
        set_context(ISSUER);
        contract.list_invoice(id.into(), PRICE.into());
    }

    #[test]
    #[should_panic(expected = "E_PRICE_TOO_HIGH")]
    fn a_price_at_or_above_the_unpaid_balance_is_refused() {
        // Paying more than the invoice can ever return would be a trap, so it is not
        // merely discouraged, it is impossible.
        let (mut contract, id) = with_tradable_invoice(AMOUNT);
        set_context(ISSUER);
        contract.list_invoice(id.into(), AMOUNT.into());
    }

    #[test]
    #[should_panic(expected = "E_PRICE_ZERO")]
    fn a_zero_price_is_refused() {
        let (mut contract, id) = with_tradable_invoice(AMOUNT);
        set_context(ISSUER);
        contract.list_invoice(id.into(), 0.into());
    }

    #[test]
    #[should_panic(expected = "E_ALREADY_LISTED")]
    fn listing_twice_is_refused() {
        let (mut contract, id) = listed(AMOUNT, PRICE);
        set_context(ISSUER);
        contract.list_invoice(id.into(), 500_000_000.into());
    }

    #[test]
    #[should_panic(expected = "E_NOT_LISTED")]
    fn unlisting_something_not_for_sale_is_refused() {
        let (mut contract, id) = with_tradable_invoice(AMOUNT);
        set_context(ISSUER);
        contract.unlist_invoice(id.into());
    }

    // --- the listing view carries what a buyer needs to price risk ---

    #[test]
    fn the_listing_view_shows_the_risk_picture() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let sig = signed_for(&contract, id, CLIENT, "accept");
        set_context(CLIENT);
        contract.accept_invoice(id.into(), sig);
        let _ = pay_as(&mut contract, USDC, 200_000_000, &pay_msg(id));
        set_context(ISSUER);
        contract.list_invoice(id.into(), 800_000_000.into());

        let view = contract.get_listing(id.into()).expect("a listing");
        assert_eq!(view.price.0, 800_000_000);
        assert_eq!(view.unpaid.0, 1_000_000_000, "what the buyer collects");
        assert_eq!(view.discount.0, 200_000_000, "gross upside if paid in full");
        assert_eq!(view.days_to_due, 30);
        assert_eq!(view.invoice.status, crate::types::StatusView::PartiallyPaid);
        // The client accepted, so a buyer has a record to judge.
        assert_eq!(
            view.client_reputation.as_ref().unwrap().accepted_as_client,
            1
        );
    }

    #[test]
    fn an_unaccepted_client_shows_no_reputation() {
        // `None` is the signal: there is no payment history to go on.
        let (mut contract, id) = listed(AMOUNT, PRICE);
        let view = contract.get_listing(id.into()).unwrap();
        assert!(view.client_reputation.is_none());
        let _ = &mut contract;
    }

    #[test]
    fn listings_paginate_and_drop_when_sold_or_settled() {
        let (mut contract, id) = listed(AMOUNT, PRICE);
        assert_eq!(contract.get_listings(None, None).len(), 1);
        assert_eq!(contract.get_listings(Some(5.into()), None).len(), 0);

        // Settling an invoice takes it off the market.
        let _ = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));
        assert!(contract.get_listings(None, None).is_empty());
    }

    // --- buying ---

    #[test]
    fn buying_moves_the_invoice_and_pays_the_seller_in_one_step() {
        let (mut contract, id) = listed(AMOUNT, PRICE);
        set_context(USDC);
        let result = contract.ft_on_transfer(acc(CLIENT), PRICE.into(), buy_msg(id));

        assert_eq!(unused(result), None, "accepted purchases return a promise");
        assert_eq!(contract.holder_of(id), Some(acc(CLIENT)));
        assert_eq!(contract.require_invoice(id).listing, None, "delisted");
        assert!(!contract.listed.contains(&id));

        // The seller is paid in the same receipt.
        let payout = find_call("ft_transfer").expect("the seller must be paid");
        assert!(payout.args.contains("issuer.near"));
        assert!(payout.args.contains(&format!("\"{PRICE}\"")));

        let sold = ileri_event("invoice_sold").expect("invoice_sold");
        assert_eq!(sold["data"]["seller"], "issuer.near");
        assert_eq!(sold["data"]["buyer"], "client.near");
        assert_eq!(sold["data"]["price"], PRICE.to_string());
        // And NEP-171, so wallets see the move.
        assert_eq!(nft_transfer_events().len(), 1);
    }

    #[test]
    fn later_payments_go_to_the_buyer() {
        // This is the point of the whole feature.
        let (mut contract, id) = listed(AMOUNT, PRICE);
        set_context(USDC);
        let _ = contract.ft_on_transfer(acc(CLIENT), PRICE.into(), buy_msg(id));

        let _ = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));
        let payout = find_call("ft_transfer").expect("a payout");
        assert!(
            payout.args.contains("client.near"),
            "the new holder collects, not the issuer"
        );
        assert!(!payout.args.contains("issuer.near"));
    }

    #[test]
    fn overpaying_for_a_listing_refunds_the_difference() {
        let (mut contract, id) = listed(AMOUNT, PRICE);
        set_context(USDC);
        let _ = contract.ft_on_transfer(acc(CLIENT), (PRICE + 50).into(), buy_msg(id));

        // The seller still gets exactly the asking price.
        let payout = find_call("ft_transfer").expect("a payout");
        assert!(payout.args.contains(&format!("\"{PRICE}\"")));
        // And the excess comes back through the callback's return value.
        set_callback_context(near_sdk::PromiseResult::Successful(vec![]));
        let returned = contract.on_payout(acc(ISSUER), acc(USDC), PRICE.into(), 50.into());
        assert_eq!(returned.0, 50);
    }

    #[test]
    fn underpaying_refuses_and_refunds_everything() {
        let (mut contract, id) = listed(AMOUNT, PRICE);
        set_context(USDC);
        let result = contract.ft_on_transfer(acc(CLIENT), (PRICE - 1).into(), buy_msg(id));

        assert_eq!(
            unused(result),
            Some(PRICE - 1),
            "refunded in full, not part-charged"
        );
        assert_eq!(contract.holder_of(id), Some(acc(ISSUER)), "unsold");
        assert_eq!(
            contract.require_invoice(id).listing,
            Some(PRICE),
            "still listed"
        );
        assert!(ileri_event("invoice_sold").is_none());
    }

    #[test]
    fn you_cannot_buy_your_own_listing() {
        let (mut contract, id) = listed(AMOUNT, PRICE);
        set_context(USDC);
        let result = contract.ft_on_transfer(acc(ISSUER), PRICE.into(), buy_msg(id));

        assert_eq!(unused(result), Some(PRICE));
        assert_eq!(contract.holder_of(id), Some(acc(ISSUER)));
        assert_eq!(contract.require_invoice(id).listing, Some(PRICE));
    }

    #[test]
    fn buying_something_not_for_sale_refunds() {
        let (mut contract, id) = with_tradable_invoice(AMOUNT);
        set_context(USDC);
        let result = contract.ft_on_transfer(acc(CLIENT), PRICE.into(), buy_msg(id));
        assert_eq!(unused(result), Some(PRICE));
        assert_eq!(contract.holder_of(id), Some(acc(ISSUER)));
    }

    #[test]
    fn buying_with_the_wrong_token_refunds() {
        let mut contract = setup(OWNER);
        set_context(OWNER);
        contract.add_allowed_token(acc(OTHER_TOKEN));
        set_context_with_deposit(ISSUER, mint_deposit());
        let id = contract
            .create_invoice(
                invite_public_key(),
                acc(USDC),
                AMOUNT.into(),
                future_due().into(),
                vec![3u8; 32].into(),
                None,
            )
            .0;
        force_status(&mut contract, id, Status::Accepted, 0);
        set_context(ISSUER);
        contract.list_invoice(id.into(), PRICE.into());

        set_context(OTHER_TOKEN);
        let result = contract.ft_on_transfer(acc(CLIENT), PRICE.into(), buy_msg(id));
        assert_eq!(
            unused(result),
            Some(PRICE),
            "a listing is priced in its own token"
        );
        assert_eq!(contract.holder_of(id), Some(acc(ISSUER)));
    }

    #[test]
    fn buying_an_unknown_invoice_refunds() {
        let (mut contract, _id) = listed(AMOUNT, PRICE);
        set_context(USDC);
        let result = contract.ft_on_transfer(acc(CLIENT), PRICE.into(), buy_msg(999));
        assert_eq!(unused(result), Some(PRICE));
    }

    #[test]
    fn a_spoofed_buyer_cannot_take_an_invoice() {
        // The same guard that protects payments protects purchases: a caller that is not
        // an allowlisted token cannot assert that money arrived.
        let (mut contract, id) = listed(AMOUNT, PRICE);
        set_context(STRANGER);
        let result = contract.ft_on_transfer(acc(STRANGER), PRICE.into(), buy_msg(id));

        assert_eq!(unused(result), Some(PRICE));
        assert_eq!(contract.holder_of(id), Some(acc(ISSUER)), "not stolen");
        assert!(ileri_event("invoice_sold").is_none());
    }
}
