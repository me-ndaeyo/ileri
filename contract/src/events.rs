//! Ileri's own NEP-297 events, under the `ileri` standard.
//!
//! These are what the app and any indexer read to build a timeline without polling views.
//! NEP-171 `nft_mint`, `nft_transfer` and `nft_burn` are emitted separately by the NFT
//! layer, so wallets and explorers see token movement through the standard they already
//! understand; these events carry the invoice meaning on top of it.
//!
//! Every amount is a decimal string and every id is a string, so no indexer can lose
//! precision by parsing money as a float or an id as a JSON number.
//!
//! An event is emitted only after the state change it describes has been committed. A
//! consumer can treat each one as settled fact.

use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, near};

#[near(event_json(standard = "ileri"))]
pub enum Event {
    #[event_version("1.0.0")]
    InvoiceCreated {
        invoice_id: U64,
        issuer: AccountId,
        token: AccountId,
        amount: U128,
        due_date: U64,
    },

    /// The client bound themselves with a valid invite signature.
    #[event_version("1.0.0")]
    InvoiceAccepted { invoice_id: U64, client: AccountId },

    #[event_version("1.0.0")]
    InvoiceRejected { invoice_id: U64, by: AccountId },

    #[event_version("1.0.0")]
    InvoiceCancelled { invoice_id: U64, issuer: AccountId },

    /// The issuer replaced the invite key, so any previously shared link is dead.
    #[event_version("1.0.0")]
    InviteRotated { invoice_id: U64 },

    /// Money applied to an invoice.
    ///
    /// `from` is the NEP-141 sender, which for a cross-chain payment is the Intents
    /// contract rather than the person paying, so it is not a reliable identity.
    /// `settled` says whether this payment completed the invoice, saving consumers from
    /// re-deriving it from `paid` and `amount`.
    #[event_version("1.0.0")]
    InvoicePaid {
        invoice_id: U64,
        from: AccountId,
        token: AccountId,
        applied: U128,
        paid: U128,
        amount: U128,
        settled: bool,
    },

    /// A payout could not be pushed and is now owed to `account`.
    #[event_version("1.0.0")]
    PayoutDeferred {
        account: AccountId,
        token: AccountId,
        amount: U128,
    },

    #[event_version("1.0.0")]
    ClaimableWithdrawn {
        account: AccountId,
        token: AccountId,
        amount: U128,
    },

    /// The NFT was burned and the record removed.
    #[event_version("1.0.0")]
    InvoiceClosed { invoice_id: U64, by: AccountId },
}

#[cfg(test)]
mod tests {
    use crate::test_utils::*;
    use crate::types::Status;

    const AMOUNT: u128 = 1_200_000_000;

    #[test]
    fn creating_emits_both_the_nft_and_the_invoice_event() {
        let (_contract, _id) = with_invoice(AMOUNT);

        // NEP-171, so wallets and explorers see the token.
        let mint = events()
            .into_iter()
            .find(|e| e["standard"] == "nep171" && e["event"] == "nft_mint")
            .expect("nft_mint must be emitted");
        assert_eq!(mint["data"][0]["owner_id"], "issuer.near");

        // NEP-297 under our own standard, carrying the invoice meaning.
        let created = ileri_event("invoice_created").expect("invoice_created must be emitted");
        assert_eq!(created["version"], "1.0.0");
        assert_eq!(created["data"]["invoice_id"], "1");
        assert_eq!(created["data"]["issuer"], "issuer.near");
        assert_eq!(created["data"]["token"], "usdc.near");
        // Money and ids are strings, so no indexer can lose precision on them.
        assert_eq!(created["data"]["amount"], AMOUNT.to_string());
        assert_eq!(created["data"]["due_date"], future_due().to_string());
    }

    #[test]
    fn accepting_emits() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let sig = signed_for(&contract, id, CLIENT, "accept");
        set_context(CLIENT);
        contract.accept_invoice(id.into(), sig);

        let accepted = ileri_event("invoice_accepted").expect("invoice_accepted");
        assert_eq!(accepted["data"]["invoice_id"], "1");
        assert_eq!(accepted["data"]["client"], "client.near");
    }

    #[test]
    fn rejecting_emits() {
        // One invoice per test: `testing_env!` carries mocked storage across calls, so a
        // second mint in the same test collides on token_id.
        let (mut contract, id) = with_invoice(AMOUNT);
        let sig = signed_for(&contract, id, CLIENT, "reject");
        set_context(CLIENT);
        contract.reject_invoice(id.into(), None, sig);

        let rejected = ileri_event("invoice_rejected").expect("invoice_rejected");
        assert_eq!(rejected["data"]["invoice_id"], "1");
        assert_eq!(rejected["data"]["by"], "client.near");
    }

    #[test]
    fn cancelling_closing_and_rotating_emit() {
        let (mut contract, id) = with_invoice(AMOUNT);

        set_context(ISSUER);
        contract.rotate_invite(id.into(), near_public_key(&other_signing_key()));
        assert_eq!(
            ileri_event("invite_rotated").expect("invite_rotated")["data"]["invoice_id"],
            "1"
        );

        contract.cancel_invoice(id.into());
        let cancelled = ileri_event("invoice_cancelled").expect("invoice_cancelled");
        assert_eq!(cancelled["data"]["issuer"], "issuer.near");

        contract.close_invoice(id.into());
        let closed = ileri_event("invoice_closed").expect("invoice_closed");
        assert_eq!(closed["data"]["by"], "issuer.near");
        // And the NEP-171 burn, so the token disappears from wallets too.
        assert!(
            events()
                .iter()
                .any(|e| e["standard"] == "nep171" && e["event"] == "nft_burn"),
            "nft_burn must be emitted"
        );
    }

    #[test]
    fn a_partial_payment_reports_settled_false() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);
        let _ = pay_as(&mut contract, USDC, 500_000_000, &pay_msg(id));

        let paid = ileri_event("invoice_paid").expect("invoice_paid");
        assert_eq!(paid["data"]["applied"], "500000000");
        assert_eq!(paid["data"]["paid"], "500000000");
        assert_eq!(paid["data"]["amount"], AMOUNT.to_string());
        assert_eq!(paid["data"]["settled"], false);
        assert_eq!(paid["data"]["token"], "usdc.near");
    }

    #[test]
    fn a_settling_payment_reports_settled_true() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);
        let _ = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));

        let paid = ileri_event("invoice_paid").expect("invoice_paid");
        assert_eq!(paid["data"]["settled"], true);
        assert_eq!(paid["data"]["paid"], AMOUNT.to_string());
    }

    #[test]
    fn an_overpayment_reports_only_what_was_applied() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);
        let _ = pay_as(&mut contract, USDC, AMOUNT * 3, &pay_msg(id));

        let paid = ileri_event("invoice_paid").expect("invoice_paid");
        assert_eq!(paid["data"]["applied"], AMOUNT.to_string());
        assert_eq!(paid["data"]["paid"], AMOUNT.to_string());
    }

    #[test]
    fn a_rejected_payment_emits_nothing() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let _ = pay_as(&mut contract, STRANGER, AMOUNT, &pay_msg(id));
        assert!(
            ileri_event("invoice_paid").is_none(),
            "a refused payment must not look like a payment to an indexer"
        );
    }

    #[test]
    fn deferred_and_withdrawn_payouts_emit() {
        let (mut contract, _id) = with_invoice(AMOUNT);

        set_callback_context(near_sdk::PromiseResult::Failed);
        contract.on_payout(acc(ISSUER), acc(USDC), AMOUNT.into(), 0.into());
        let deferred = ileri_event("payout_deferred").expect("payout_deferred");
        assert_eq!(deferred["data"]["account"], "issuer.near");
        assert_eq!(deferred["data"]["amount"], AMOUNT.to_string());

        set_context(ISSUER);
        let _ = contract.withdraw_claimable(acc(USDC));
        let withdrawn = ileri_event("claimable_withdrawn").expect("claimable_withdrawn");
        assert_eq!(withdrawn["data"]["amount"], AMOUNT.to_string());
    }

    #[test]
    fn a_successful_payout_emits_no_deferral() {
        let (mut contract, _id) = with_invoice(AMOUNT);
        set_callback_context(near_sdk::PromiseResult::Successful(vec![]));
        contract.on_payout(acc(ISSUER), acc(USDC), AMOUNT.into(), 0.into());
        assert!(ileri_event("payout_deferred").is_none());
    }
}
