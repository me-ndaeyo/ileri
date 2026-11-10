//! Reputation: plain counters, no score and no formula.
//!
//! The app shows the raw numbers and a buyer judges for themselves. A single blended
//! score would hide exactly the detail that matters when pricing an invoice, and would
//! invite gaming a weighting nobody agreed on.
//!
//! Counters are only ever attributed to an account that actually did something. In
//! particular, an invoice paid in full while still unaccepted records no client
//! reputation: nobody signed for it, so there is no one to credit or blame.

use near_sdk::json_types::U128;
use near_sdk::{AccountId, near};

use crate::math;
use crate::types::Rep;
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    /// Everything publicly known about how an account has behaved.
    pub fn get_reputation(&self, account_id: AccountId) -> Rep {
        self.reputation
            .get(&account_id)
            .cloned()
            .unwrap_or_default()
    }

    /// Total settled on invoices where this account was the bound client, per token.
    pub fn get_volume_paid(&self, account_id: AccountId, token: AccountId) -> U128 {
        U128(
            self.volume_paid
                .get(&(account_id, token))
                .copied()
                .unwrap_or(0),
        )
    }
}

impl Contract {
    /// Read-modify-write one account's counters.
    pub(crate) fn bump_reputation(&mut self, account: &AccountId, edit: impl FnOnce(&mut Rep)) {
        let mut rep = self.reputation.get(account).cloned().unwrap_or_default();
        edit(&mut rep);
        self.reputation.insert(account.clone(), rep);
    }

    pub(crate) fn add_volume_paid(&mut self, client: &AccountId, token: &AccountId, amount: u128) {
        let key = (client.clone(), token.clone());
        let current = self.volume_paid.get(&key).copied().unwrap_or(0);
        self.volume_paid.insert(key, math::add(current, amount));
    }

    /// Record how a settled invoice reflects on its client.
    ///
    /// Called only when an invoice reaches `Paid` *and* a client is bound. Lateness is
    /// judged on when settlement happened against the due date, not on when the invoice
    /// was accepted.
    pub(crate) fn record_settlement(
        &mut self,
        client: &AccountId,
        token: &AccountId,
        amount: u128,
        settled_at: u64,
        due_date: u64,
    ) {
        let on_time = settled_at <= due_date;
        self.bump_reputation(client, |rep| {
            if on_time {
                rep.paid_on_time += 1;
            } else {
                rep.paid_late += 1;
            }
        });
        self.add_volume_paid(client, token, amount);
    }
}

#[cfg(test)]
mod tests {
    use crate::test_utils::*;
    use crate::types::Status;
    use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;

    const AMOUNT: u128 = 1_200_000_000;

    #[test]
    fn everything_starts_at_zero() {
        let (contract, _id) = with_invoice(AMOUNT);
        let rep = contract.get_reputation(acc(STRANGER));
        assert_eq!(rep.issued, 0);
        assert_eq!(rep.accepted_as_client, 0);
        assert_eq!(rep.paid_on_time, 0);
        assert_eq!(rep.paid_late, 0);
        assert_eq!(contract.get_volume_paid(acc(STRANGER), acc(USDC)).0, 0);
    }

    #[test]
    fn issuing_counts_against_the_issuer() {
        let mut contract = setup(OWNER);
        for _ in 0..3 {
            set_context_with_deposit(ISSUER, mint_deposit());
            contract.create_invoice(
                invite_public_key(),
                acc(USDC),
                AMOUNT.into(),
                future_due().into(),
                vec![3u8; 32].into(),
                None,
            );
        }
        assert_eq!(contract.get_reputation(acc(ISSUER)).issued, 3);
        // And nobody else's record moves.
        assert_eq!(contract.get_reputation(acc(CLIENT)).issued, 0);
    }

    #[test]
    fn accepting_counts_against_the_client() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let sig = signed_for(&contract, id, CLIENT, "accept");
        set_context(CLIENT);
        contract.accept_invoice(id.into(), sig);

        assert_eq!(contract.get_reputation(acc(CLIENT)).accepted_as_client, 1);
        assert_eq!(contract.get_reputation(acc(ISSUER)).accepted_as_client, 0);
    }

    #[test]
    fn rejecting_is_recorded_on_both_sides() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let sig = signed_for(&contract, id, CLIENT, "reject");
        set_context(CLIENT);
        contract.reject_invoice(id.into(), None, sig);

        // A buyer cares that this issuer gets invoices rejected...
        assert_eq!(contract.get_reputation(acc(ISSUER)).rejected_as_issuer, 1);
        // ...and that this account rejects invoices.
        assert_eq!(contract.get_reputation(acc(CLIENT)).rejected_as_client, 1);
    }

    #[test]
    fn cancelling_counts_against_the_issuer() {
        let (mut contract, id) = with_invoice(AMOUNT);
        set_context(ISSUER);
        contract.cancel_invoice(id.into());
        assert_eq!(contract.get_reputation(acc(ISSUER)).cancelled, 1);
    }

    #[test]
    fn settling_on_time_is_recorded_with_volume() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let sig = signed_for(&contract, id, CLIENT, "accept");
        set_context(CLIENT);
        contract.accept_invoice(id.into(), sig);

        // Paid before the due date.
        let _ = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));

        let rep = contract.get_reputation(acc(CLIENT));
        assert_eq!(rep.paid_on_time, 1);
        assert_eq!(rep.paid_late, 0);
        assert_eq!(contract.get_volume_paid(acc(CLIENT), acc(USDC)).0, AMOUNT);
    }

    #[test]
    fn settling_late_is_recorded_as_late() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let sig = signed_for(&contract, id, CLIENT, "accept");
        set_context(CLIENT);
        contract.accept_invoice(id.into(), sig);

        // Lateness is judged on when settlement happened, not on when it was accepted.
        set_context_at(USDC, future_due() + DAY);
        let _ = contract.ft_on_transfer(acc(STRANGER), AMOUNT.into(), pay_msg(id));

        let rep = contract.get_reputation(acc(CLIENT));
        assert_eq!(rep.paid_late, 1);
        assert_eq!(rep.paid_on_time, 0);
    }

    #[test]
    fn a_partial_payment_records_nothing_yet() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let sig = signed_for(&contract, id, CLIENT, "accept");
        set_context(CLIENT);
        contract.accept_invoice(id.into(), sig);

        let _ = pay_as(&mut contract, USDC, 500_000_000, &pay_msg(id));

        let rep = contract.get_reputation(acc(CLIENT));
        assert_eq!(rep.paid_on_time, 0, "only a settled invoice counts");
        assert_eq!(rep.paid_late, 0);
        assert_eq!(contract.get_volume_paid(acc(CLIENT), acc(USDC)).0, 0);
    }

    #[test]
    fn an_invoice_settled_while_unaccepted_records_no_client_reputation() {
        // Paying an unaccepted invoice in full settles it, but nobody signed for it, so
        // there is no account to credit or blame.
        let (mut contract, id) = with_invoice(AMOUNT);
        let _ = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));

        assert_eq!(contract.require_invoice(id).status, Status::Paid);
        assert_eq!(contract.require_invoice(id).client, None);
        for who in [CLIENT, ISSUER, STRANGER] {
            let rep = contract.get_reputation(acc(who));
            assert_eq!(rep.paid_on_time, 0, "{who} must not be credited");
            assert_eq!(rep.paid_late, 0);
            assert_eq!(contract.get_volume_paid(acc(who), acc(USDC)).0, 0);
        }
    }

    #[test]
    fn volume_is_tracked_per_token() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let sig = signed_for(&contract, id, CLIENT, "accept");
        set_context(CLIENT);
        contract.accept_invoice(id.into(), sig);
        let _ = pay_as(&mut contract, USDC, AMOUNT, &pay_msg(id));

        assert_eq!(contract.get_volume_paid(acc(CLIENT), acc(USDC)).0, AMOUNT);
        assert_eq!(contract.get_volume_paid(acc(CLIENT), acc(OTHER_TOKEN)).0, 0);
    }

    #[test]
    fn the_numbers_are_raw_counts_with_no_score() {
        // The view returns counters only. A blended score would hide the detail a buyer
        // needs and invite gaming a weighting nobody agreed on.
        let (mut contract, id) = with_invoice(AMOUNT);
        let sig = signed_for(&contract, id, CLIENT, "accept");
        set_context(CLIENT);
        contract.accept_invoice(id.into(), sig);

        let json = near_sdk::serde_json::to_value(contract.get_reputation(acc(CLIENT))).unwrap();
        let keys: Vec<&str> = json
            .as_object()
            .unwrap()
            .keys()
            .map(|k| k.as_str())
            .collect();
        assert_eq!(
            keys,
            vec![
                "issued",
                "rejected_as_issuer",
                "cancelled",
                "accepted_as_client",
                "rejected_as_client",
                "paid_on_time",
                "paid_late"
            ]
        );
    }
}
