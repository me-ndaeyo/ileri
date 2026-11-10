//! Payment intake and payout.
//!
//! All money enters through `ft_on_transfer` and leaves to whoever holds the invoice NFT
//! at that moment. Nothing else in the contract can move funds.
//!
//! # Why rejections return rather than panic
//!
//! Anyone can call `ft_on_transfer` directly and claim tokens arrived. Two guards stop
//! that: the caller must be an allowlisted token contract, and that token must be the one
//! the invoice is denominated in. Both failures *return the full amount* rather than
//! panicking, which is correct in both situations that produce them. When a real but
//! wrong token called, tokens genuinely moved and NEP-141 refunds exactly what we return.
//! When an impostor called, no tokens moved, the return value is meaningless to them, and
//! the point is simply that no state changed. One rule covers both.
//!
//! # Why the callback returns the excess
//!
//! When `ft_on_transfer` returns a promise, NEP-141 takes the *last callback's* return
//! value as the unused amount. So [`Contract::on_payout`] returns the overpayment.
//! Returning `()` there would silently strand every overpayment in this contract.

use near_contract_standards::fungible_token::core::ext_ft_core;
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::json_types::U128;
use near_sdk::serde_json;
use near_sdk::{AccountId, Promise, PromiseError, PromiseOrValue, env, near};

use crate::errors::E_NOTHING_CLAIMABLE;
use crate::events::Event;
use crate::gas::{GAS_FT_TRANSFER, GAS_ON_PAYOUT, GAS_ON_WITHDRAW_RESOLVE, ONE_YOCTO};
use crate::guards::caller;
use crate::math;
use crate::types::{Status, TransferMsg};

/// `ft_transfer` returns nothing, so a few bytes is a generous bound. Reading the
/// result with a bound is what `promise_result_checked` is for: an unbounded read can
/// run out of gas on a token that returns something large.
const PAYOUT_RESULT_MAX_LEN: usize = 64;

/// Did the awaited promise definitively fail?
///
/// Matches `Err(Failed)` specifically rather than `is_err()`. A `TooLong` error means
/// the promise *succeeded* with an oversized return value, and treating that as a
/// failure would credit `claimable` for money that was already delivered.
fn promise_failed() -> bool {
    matches!(
        env::promise_result_checked(0, PAYOUT_RESULT_MAX_LEN),
        Err(PromiseError::Failed)
    )
}
use crate::{Contract, ContractExt};

#[near]
impl FungibleTokenReceiver for Contract {
    /// Apply an incoming NEP-141 transfer to an invoice and push it to the holder.
    ///
    /// `msg` is `{"action":"pay","invoice_id":"42"}`, which is also what 1Click puts in
    /// `customRecipientMsg` so a cross-chain payment lands here directly.
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        // `sender_id` is reported in the event but never trusted as an identity. For a
        // cross-chain payment it is the Intents contract, not the person paying. It also
        // means NEP-141 refunds any excess to *that* account rather than the payer, which
        // is why quotes use EXACT_OUTPUT to keep the excess at zero.

        let token = caller();

        // Guard 1: only a token contract we trust may assert that tokens arrived.
        if !self.allowed_tokens.contains(&token) {
            return PromiseOrValue::Value(amount);
        }

        let Ok(parsed) = serde_json::from_str::<TransferMsg>(&msg) else {
            return PromiseOrValue::Value(amount);
        };

        let invoice_id = match parsed {
            TransferMsg::Pay { invoice_id } => invoice_id.0,
            // The marketplace lands in build step 2.
            TransferMsg::Buy { .. } => return PromiseOrValue::Value(amount),
        };

        let Some(mut invoice) = self.invoices.get(&invoice_id).cloned() else {
            return PromiseOrValue::Value(amount);
        };

        // Guard 2: the right token for *this* invoice, not merely a trusted one.
        if invoice.token != token {
            return PromiseOrValue::Value(amount);
        }

        if !invoice.is_payable() {
            return PromiseOrValue::Value(amount);
        }

        let applied = amount.0.min(invoice.unpaid());
        if applied == 0 {
            return PromiseOrValue::Value(amount);
        }
        let excess = math::sub(amount.0, applied);

        let Some(holder) = self.holder_of(invoice_id) else {
            return PromiseOrValue::Value(amount);
        };

        // Commit every state change before scheduling the outgoing transfer. The callback
        // runs in a later block, so anything written after this point could be read stale.
        let now = env::block_timestamp();
        invoice.paid = math::add(invoice.paid, applied);

        if invoice.is_fully_paid() {
            // Paying an unaccepted invoice in full counts as acceptance, but binds no
            // client: nobody signed, so no client reputation may be attributed to it.
            if invoice.status == Status::Issued {
                invoice.accepted_at = Some(now);
            }
            invoice.status = Status::Paid;
            invoice.paid_at = Some(now);
            invoice.listing = None;
        } else if invoice.status != Status::Issued {
            invoice.status = Status::PartiallyPaid;
        }
        // A partial payment on an Issued invoice leaves it Issued, so it stays untradable
        // until the client has actually agreed to it.

        let settled = invoice.status == Status::Paid;
        let paid_total = invoice.paid;
        let client = invoice.client.clone();
        let due_date = invoice.due_date;
        let total = invoice.amount;
        self.invoices.insert(invoice_id, invoice);
        if settled {
            self.listed.remove(&invoice_id);
        }

        // An invoice settled while still unaccepted has no bound client, so there is
        // nobody to attribute the payment record to. Deliberately no reputation then.
        if settled && let Some(client) = &client {
            self.record_settlement(client, &token, total, now, due_date);
        }

        Event::InvoicePaid {
            invoice_id: invoice_id.into(),
            from: sender_id,
            token: token.clone(),
            applied: U128(applied),
            paid: U128(paid_total),
            amount: U128(total),
            settled,
        }
        .emit();

        PromiseOrValue::Promise(
            ext_ft_core::ext(token.clone())
                .with_attached_deposit(ONE_YOCTO)
                .with_static_gas(GAS_FT_TRANSFER)
                .ft_transfer(
                    holder.clone(),
                    U128(applied),
                    Some(format!("ileri invoice {invoice_id}")),
                )
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(GAS_ON_PAYOUT)
                        .on_payout(holder, token, U128(applied), U128(excess)),
                ),
        )
    }
}

#[near]
impl Contract {
    /// Resolve a payout. Push first, pull as the safety net.
    ///
    /// A push fails when the holder is not registered on the token contract. Rather than
    /// let the payment fail with it, the amount is recorded as claimable and the holder
    /// withdraws it after registering.
    ///
    /// Returns the overpayment, which is what NEP-141 refunds to the sender.
    #[private]
    pub fn on_payout(
        &mut self,
        holder: AccountId,
        token: AccountId,
        applied: U128,
        excess: U128,
    ) -> U128 {
        if promise_failed() {
            Event::PayoutDeferred {
                account: holder.clone(),
                token: token.clone(),
                amount: applied,
            }
            .emit();
            self.credit_claimable(holder, token, applied.0);
        }
        excess
    }

    /// Withdraw a stuck payout, in the token it is held in.
    pub fn withdraw_claimable(&mut self, token: AccountId) -> Promise {
        let who = caller();
        let key = (who.clone(), token.clone());

        let balance = self.claimable.get(&key).copied().unwrap_or(0);
        if balance == 0 {
            env::panic_str(E_NOTHING_CLAIMABLE);
        }

        // Clear the balance before sending, so a second call in the same block cannot
        // withdraw it twice. `on_withdraw_resolve` puts it back if the send fails, which
        // is what makes zeroing first safe rather than lossy.
        self.claimable.remove(&key);

        Event::ClaimableWithdrawn {
            account: who.clone(),
            token: token.clone(),
            amount: U128(balance),
        }
        .emit();

        ext_ft_core::ext(token.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(
                who.clone(),
                U128(balance),
                Some("ileri claimable withdrawal".to_string()),
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(GAS_ON_WITHDRAW_RESOLVE)
                    .on_withdraw_resolve(who, token, U128(balance)),
            )
    }

    /// Restore a withdrawal that could not be delivered.
    #[private]
    pub fn on_withdraw_resolve(&mut self, account: AccountId, token: AccountId, amount: U128) {
        if promise_failed() {
            self.credit_claimable(account, token, amount.0);
        }
    }

    pub fn get_claimable(&self, account_id: AccountId, token: AccountId) -> U128 {
        U128(
            self.claimable
                .get(&(account_id, token))
                .copied()
                .unwrap_or(0),
        )
    }
}

impl Contract {
    fn credit_claimable(&mut self, account: AccountId, token: AccountId, amount: u128) {
        let key = (account, token);
        let current = self.claimable.get(&key).copied().unwrap_or(0);
        self.claimable.insert(key, math::add(current, amount));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;
    use crate::types::Status;

    const AMOUNT: u128 = 1_200_000_000;

    /// Nothing about the invoice changed. Used by every rejection test, because a
    /// rejection that still mutated state would be the actual bug.
    fn assert_untouched(contract: &Contract, id: u64) {
        let invoice = contract.require_invoice(id);
        assert_eq!(invoice.paid, 0, "no money may be credited");
        assert_eq!(invoice.status, Status::Issued);
        assert_eq!(invoice.paid_at, None);
        assert_eq!(invoice.accepted_at, None);
        assert!(
            find_call("ft_transfer").is_none(),
            "no payout may be scheduled"
        );
    }

    // --- 1: the headline spoof. Anyone can call ft_on_transfer directly. ---

    #[test]
    fn a_caller_that_is_not_an_allowlisted_token_is_refused() {
        let (mut contract, id) = with_invoice(AMOUNT);
        // A contract that simply claims tokens arrived. None did.
        let result = pay_as(&mut contract, STRANGER, AMOUNT, &pay_msg(id));

        assert_eq!(unused(result), Some(AMOUNT), "the full amount is returned");
        assert_untouched(&contract, id);
    }

    #[test]
    fn even_the_issuer_cannot_fake_a_payment() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let result = pay_as(&mut contract, ISSUER, AMOUNT, &pay_msg(id));
        assert_eq!(unused(result), Some(AMOUNT));
        assert_untouched(&contract, id);
    }

    #[test]
    fn the_contract_itself_cannot_fake_a_payment() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let result = pay_as(&mut contract, CONTRACT, AMOUNT, &pay_msg(id));
        assert_eq!(unused(result), Some(AMOUNT));
        assert_untouched(&contract, id);
    }

    // --- 2: right shape, wrong token ---

    #[test]
    fn an_allowlisted_token_that_is_not_the_invoice_token_is_refused() {
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

        // DAI is allowlisted, but this invoice is denominated in USDC. Paying it in the
        // wrong token would otherwise credit the invoice with the wrong asset.
        let result = pay_as(&mut contract, OTHER_TOKEN, AMOUNT, &pay_msg(id));
        assert_eq!(unused(result), Some(AMOUNT));
        assert_untouched(&contract, id);
    }

    // --- 3, 4, 5, 6: bad messages and unknown invoices ---

    #[test]
    fn a_malformed_message_is_refused() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let result = pay_as(&mut contract, USDC, AMOUNT, "not json");
        assert_eq!(unused(result), Some(AMOUNT));
        assert_untouched(&contract, id);
    }

    #[test]
    fn an_empty_message_is_refused() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let result = pay_as(&mut contract, USDC, AMOUNT, "");
        assert_eq!(unused(result), Some(AMOUNT));
        assert_untouched(&contract, id);
    }

    #[test]
    fn an_unknown_action_is_refused() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let result = pay_as(
            &mut contract,
            USDC,
            AMOUNT,
            &format!(r#"{{"action":"steal","invoice_id":"{id}"}}"#),
        );
        assert_eq!(unused(result), Some(AMOUNT));
        assert_untouched(&contract, id);
    }

    #[test]
    fn a_buy_is_refused_until_the_marketplace_lands() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let result = pay_as(
            &mut contract,
            USDC,
            AMOUNT,
            &format!(r#"{{"action":"buy","invoice_id":"{id}"}}"#),
        );
        assert_eq!(unused(result), Some(AMOUNT));
        assert_untouched(&contract, id);
    }

    #[test]
    fn an_unknown_invoice_is_refused() {
        let (mut contract, _id) = with_invoice(AMOUNT);
        let result = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(999));
        assert_eq!(unused(result), Some(AMOUNT), "must refund, never panic");
    }

    // --- 7, 8, 9: states that cannot take money ---

    #[test]
    fn a_rejected_invoice_returns_the_money() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Rejected, 0);
        let result = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));
        assert_eq!(unused(result), Some(AMOUNT));
        assert_eq!(contract.require_invoice(id).paid, 0);
    }

    #[test]
    fn a_cancelled_invoice_returns_the_money() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Cancelled, 0);
        let result = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));
        assert_eq!(unused(result), Some(AMOUNT));
        assert_eq!(contract.require_invoice(id).paid, 0);
    }

    #[test]
    fn a_fully_paid_invoice_returns_the_money() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Paid, AMOUNT);
        let result = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));
        assert_eq!(unused(result), Some(AMOUNT), "no double payment");
        assert_eq!(contract.require_invoice(id).paid, AMOUNT, "unchanged");
    }

    // --- 10 to 20: the amounts ---

    #[test]
    fn a_partial_payment_on_an_accepted_invoice_lands_in_partially_paid() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);

        let result = pay_as(&mut contract, USDC, 500_000_000, &pay_msg(id));
        assert_eq!(unused(result), None, "accepted payments return a promise");

        let invoice = contract.require_invoice(id);
        assert_eq!(invoice.paid, 500_000_000);
        assert_eq!(invoice.status, Status::PartiallyPaid);
        assert_eq!(invoice.paid_at, None);
    }

    #[test]
    fn a_partial_payment_on_an_issued_invoice_stays_issued() {
        // Paying part of an unaccepted invoice must not make it tradable: the client has
        // not agreed to it yet, so there is nothing for a buyer to rely on.
        let (mut contract, id) = with_invoice(AMOUNT);
        let _ = pay_as(&mut contract, USDC, 500_000_000, &pay_msg(id));

        let invoice = contract.require_invoice(id);
        assert_eq!(invoice.paid, 500_000_000);
        assert_eq!(invoice.status, Status::Issued);
        assert_eq!(invoice.accepted_at, None);
    }

    #[test]
    fn successive_partials_settle_the_invoice() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);

        let _ = pay_as(&mut contract, USDC, 700_000_000, &pay_msg(id));
        assert_eq!(contract.require_invoice(id).status, Status::PartiallyPaid);

        let _ = pay_as(&mut contract, USDC, 500_000_000, &pay_msg(id));
        let invoice = contract.require_invoice(id);
        assert_eq!(invoice.paid, AMOUNT);
        assert_eq!(invoice.status, Status::Paid);
        assert_eq!(invoice.paid_at, Some(NOW));
    }

    #[test]
    fn paying_an_accepted_invoice_in_full_settles_it() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);

        let _ = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));
        let invoice = contract.require_invoice(id);
        assert_eq!(invoice.paid, AMOUNT);
        assert_eq!(invoice.status, Status::Paid);
        assert_eq!(invoice.paid_at, Some(NOW));
        assert_eq!(invoice.listing, None);
    }

    #[test]
    fn paying_an_issued_invoice_in_full_counts_as_acceptance_but_binds_no_client() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let _ = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));

        let invoice = contract.require_invoice(id);
        assert_eq!(invoice.status, Status::Paid);
        assert_eq!(
            invoice.accepted_at,
            Some(NOW),
            "paying in full is acceptance"
        );
        assert_eq!(
            invoice.client, None,
            "but nobody signed, so no client reputation may be attributed"
        );
    }

    #[test]
    fn an_overpayment_applies_only_what_is_owed() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);

        let result = pay_as(&mut contract, USDC, AMOUNT * 2, &pay_msg(id));
        assert_eq!(
            unused(result),
            None,
            "the excess comes back via the callback"
        );

        let invoice = contract.require_invoice(id);
        assert_eq!(invoice.paid, AMOUNT, "paid never exceeds amount");
        assert_eq!(invoice.status, Status::Paid);

        // The payout pushes only what was owed, not what was sent.
        let payout = find_call("ft_transfer").expect("a payout must be scheduled");
        assert!(payout.args.contains(&format!("\"{AMOUNT}\"")));
    }

    #[test]
    fn paid_never_exceeds_amount_across_many_payments() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);
        for _ in 0..5 {
            let _ = pay_as(&mut contract, USDC, 400_000_000, &pay_msg(id));
            assert!(contract.require_invoice(id).paid <= AMOUNT);
        }
        assert_eq!(contract.require_invoice(id).paid, AMOUNT);
    }

    // --- 17, 18, 20: the payout goes to the holder, and state is written first ---

    #[test]
    fn the_payout_goes_to_the_current_holder_in_the_invoice_token() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);
        let _ = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));

        let payout = find_call("ft_transfer").expect("a payout must be scheduled");
        assert_eq!(
            payout.receiver,
            acc(USDC),
            "pushed through the token contract"
        );
        assert!(payout.args.contains("issuer.near"), "to the holder");
        assert_eq!(
            payout.deposit,
            near_sdk::NearToken::from_yoctonear(1),
            "NEP-141 requires exactly 1 yocto"
        );
    }

    #[test]
    fn the_payout_follows_the_nft_after_a_hand_off() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);

        // Simulate a sale: the NFT moves, so future payments must follow it.
        contract.nft.internal_transfer_unguarded(
            &Contract::token_id_of(id),
            &acc(ISSUER),
            &acc(STRANGER),
        );
        assert_eq!(contract.holder_of(id), Some(acc(STRANGER)));

        let _ = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));
        let payout = find_call("ft_transfer").expect("a payout must be scheduled");
        assert!(
            payout.args.contains("stranger.near"),
            "payment follows the invoice, not the issuer"
        );
        assert!(!payout.args.contains("issuer.near"));
    }

    #[test]
    fn state_is_committed_before_the_payout_is_scheduled() {
        // The callback may run much later. If the state were written after the outgoing
        // transfer, a reentrant read would see a stale invoice.
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);
        let _ = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));

        let invoice = contract.require_invoice(id);
        assert_eq!(invoice.paid, AMOUNT);
        assert_eq!(invoice.status, Status::Paid);
        assert!(find_call("ft_transfer").is_some());
    }

    #[test]
    fn settling_clears_any_listing() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);
        if let Some(invoice) = contract.invoices.get_mut(&id) {
            invoice.listing = Some(900_000_000);
        }
        contract.listed.insert(id);

        let _ = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));

        assert_eq!(contract.require_invoice(id).listing, None);
        assert!(
            !contract.listed.contains(&id),
            "and leaves the market index"
        );
    }

    // --- 21 to 27: payout resolution and the claimable fallback ---
    //
    // `#[private]` is enforced in the generated extern wrapper, not in the Rust method,
    // so calling `on_payout` directly here cannot exercise it. The ABI is checked for the
    // private modifier instead, and the runtime rejection is a sandbox test in step 2.

    #[test]
    fn a_failed_payout_becomes_claimable() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);
        let _ = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));

        // The holder was not registered on the token, so the push failed.
        set_callback_context(near_sdk::PromiseResult::Failed);
        let returned = contract.on_payout(acc(ISSUER), acc(USDC), AMOUNT.into(), 0.into());

        assert_eq!(returned.0, 0, "no excess to refund");
        assert_eq!(
            contract.get_claimable(acc(ISSUER), acc(USDC)).0,
            AMOUNT,
            "the money is owed to the holder, not lost"
        );
        // The invoice still reads as paid: the client did pay.
        assert_eq!(contract.require_invoice(id).status, Status::Paid);
    }

    #[test]
    fn a_successful_payout_leaves_nothing_claimable() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);
        let _ = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));

        set_callback_context(near_sdk::PromiseResult::Successful(vec![]));
        let returned = contract.on_payout(acc(ISSUER), acc(USDC), AMOUNT.into(), 0.into());

        assert_eq!(returned.0, 0);
        assert_eq!(contract.get_claimable(acc(ISSUER), acc(USDC)).0, 0);
    }

    #[test]
    fn the_callback_returns_the_overpayment_for_nep141_to_refund() {
        // This is the value NEP-141 reads as "unused". Returning zero here would strand
        // the overpayment in this contract.
        let (mut contract, _id) = with_invoice(AMOUNT);
        set_callback_context(near_sdk::PromiseResult::Successful(vec![]));
        let returned = contract.on_payout(acc(ISSUER), acc(USDC), AMOUNT.into(), 777.into());
        assert_eq!(returned.0, 777);

        set_callback_context(near_sdk::PromiseResult::Failed);
        let returned = contract.on_payout(acc(ISSUER), acc(USDC), AMOUNT.into(), 777.into());
        assert_eq!(returned.0, 777, "also refunded when the payout failed");
    }

    #[test]
    fn repeated_failures_accumulate_and_a_success_never_double_credits() {
        let (mut contract, _id) = with_invoice(AMOUNT);

        set_callback_context(near_sdk::PromiseResult::Failed);
        contract.on_payout(acc(ISSUER), acc(USDC), 100.into(), 0.into());
        set_callback_context(near_sdk::PromiseResult::Failed);
        contract.on_payout(acc(ISSUER), acc(USDC), 250.into(), 0.into());
        assert_eq!(contract.get_claimable(acc(ISSUER), acc(USDC)).0, 350);

        set_callback_context(near_sdk::PromiseResult::Successful(vec![]));
        contract.on_payout(acc(ISSUER), acc(USDC), 999.into(), 0.into());
        assert_eq!(
            contract.get_claimable(acc(ISSUER), acc(USDC)).0,
            350,
            "a success must not add to the balance"
        );
    }

    #[test]
    fn claimable_is_tracked_per_account_and_per_token() {
        let (mut contract, _id) = with_invoice(AMOUNT);

        set_callback_context(near_sdk::PromiseResult::Failed);
        contract.on_payout(acc(ISSUER), acc(USDC), 100.into(), 0.into());
        set_callback_context(near_sdk::PromiseResult::Failed);
        contract.on_payout(acc(ISSUER), acc(OTHER_TOKEN), 200.into(), 0.into());
        set_callback_context(near_sdk::PromiseResult::Failed);
        contract.on_payout(acc(STRANGER), acc(USDC), 300.into(), 0.into());

        assert_eq!(contract.get_claimable(acc(ISSUER), acc(USDC)).0, 100);
        assert_eq!(contract.get_claimable(acc(ISSUER), acc(OTHER_TOKEN)).0, 200);
        assert_eq!(contract.get_claimable(acc(STRANGER), acc(USDC)).0, 300);
        assert_eq!(contract.get_claimable(acc(CLIENT), acc(USDC)).0, 0);
    }

    #[test]
    fn withdrawing_clears_the_balance_and_pushes_the_tokens() {
        let (mut contract, _id) = with_invoice(AMOUNT);
        set_callback_context(near_sdk::PromiseResult::Failed);
        contract.on_payout(acc(ISSUER), acc(USDC), AMOUNT.into(), 0.into());

        set_context(ISSUER);
        let _ = contract.withdraw_claimable(acc(USDC));

        assert_eq!(
            contract.get_claimable(acc(ISSUER), acc(USDC)).0,
            0,
            "cleared before the send, so it cannot be withdrawn twice in one block"
        );
        let call = find_call("ft_transfer").expect("a transfer must be scheduled");
        assert_eq!(call.receiver, acc(USDC));
        assert!(call.args.contains("issuer.near"));
        assert!(call.args.contains(&format!("\"{AMOUNT}\"")));
    }

    #[test]
    #[should_panic(expected = "E_NOTHING_CLAIMABLE")]
    fn withdrawing_nothing_panics() {
        let (mut contract, _id) = with_invoice(AMOUNT);
        set_context(ISSUER);
        let _ = contract.withdraw_claimable(acc(USDC));
    }

    #[test]
    #[should_panic(expected = "E_NOTHING_CLAIMABLE")]
    fn withdrawing_a_token_with_no_balance_panics() {
        let (mut contract, _id) = with_invoice(AMOUNT);
        set_callback_context(near_sdk::PromiseResult::Failed);
        contract.on_payout(acc(ISSUER), acc(USDC), AMOUNT.into(), 0.into());
        set_context(ISSUER);
        let _ = contract.withdraw_claimable(acc(OTHER_TOKEN));
    }

    #[test]
    fn a_failed_withdrawal_is_restored() {
        // Without this the clear-before-send ordering would simply burn the balance.
        let (mut contract, _id) = with_invoice(AMOUNT);
        set_callback_context(near_sdk::PromiseResult::Failed);
        contract.on_payout(acc(ISSUER), acc(USDC), AMOUNT.into(), 0.into());

        set_context(ISSUER);
        let _ = contract.withdraw_claimable(acc(USDC));
        assert_eq!(contract.get_claimable(acc(ISSUER), acc(USDC)).0, 0);

        set_callback_context(near_sdk::PromiseResult::Failed);
        contract.on_withdraw_resolve(acc(ISSUER), acc(USDC), AMOUNT.into());
        assert_eq!(
            contract.get_claimable(acc(ISSUER), acc(USDC)).0,
            AMOUNT,
            "an undelivered withdrawal must come back"
        );
    }

    #[test]
    fn a_successful_withdrawal_stays_withdrawn() {
        let (mut contract, _id) = with_invoice(AMOUNT);
        set_callback_context(near_sdk::PromiseResult::Failed);
        contract.on_payout(acc(ISSUER), acc(USDC), AMOUNT.into(), 0.into());

        set_context(ISSUER);
        let _ = contract.withdraw_claimable(acc(USDC));

        set_callback_context(near_sdk::PromiseResult::Successful(vec![]));
        contract.on_withdraw_resolve(acc(ISSUER), acc(USDC), AMOUNT.into());
        assert_eq!(contract.get_claimable(acc(ISSUER), acc(USDC)).0, 0);
    }
}
