//! Client-driven actions, authorised by the invite signature rather than by a known
//! account id. See [`crate::invite`] for what the signature binds and why.

use near_sdk::json_types::{Base64VecU8, U64};
use near_sdk::{env, near};

use crate::errors::{E_ISSUER_CANNOT_ACT_AS_CLIENT, E_NOT_EXPECTED_CLIENT};
use crate::events::Event;
use crate::guards::caller;
use crate::invite::{self, InviteAction};
use crate::types::{Status, to_hash32};
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    /// Accept an invoice and bind the caller as its client.
    ///
    /// Allowed while the invoice is `Issued`, including when money has already arrived:
    /// an invoice can be paid before it is accepted, and accepting then simply records
    /// who agreed to it.
    pub fn accept_invoice(&mut self, id: U64, invite_sig: Base64VecU8) {
        let id = id.0;
        let who = caller();
        let mut invoice = self.require_invoice(id);

        self.assert_issued(&invoice);
        self.assert_not_issuer(&invoice, &who);
        self.assert_expected_client(&invoice, &who);
        invite::verify(&invoice, id, &who, InviteAction::Accept, &invite_sig);

        invoice.client = Some(who.clone());
        invoice.accepted_at = Some(env::block_timestamp());
        // Money that arrived before acceptance is not lost or re-applied; it just means
        // the invoice lands in PartiallyPaid rather than Accepted.
        invoice.status = if invoice.paid > 0 {
            Status::PartiallyPaid
        } else {
            Status::Accepted
        };

        self.invoices.insert(id, invoice);
        self.push_client_index(&who, id);

        self.bump_reputation(&who, |rep| rep.accepted_as_client += 1);
        Event::InvoiceAccepted {
            invoice_id: id.into(),
            client: who,
        }
        .emit();
    }

    /// Reject an invoice.
    ///
    /// Only while nothing has been paid. Once money has arrived there is a payee with a
    /// claim on it, so the invoice can no longer be voided.
    ///
    /// `reason_hash` is the sha256 of an offchain reason note; the text itself never goes
    /// onchain.
    pub fn reject_invoice(
        &mut self,
        id: U64,
        reason_hash: Option<Base64VecU8>,
        invite_sig: Base64VecU8,
    ) {
        let id = id.0;
        let who = caller();
        let mut invoice = self.require_invoice(id);

        self.assert_issued(&invoice);
        self.assert_nothing_paid(&invoice);
        self.assert_not_issuer(&invoice, &who);
        self.assert_expected_client(&invoice, &who);
        invite::verify(&invoice, id, &who, InviteAction::Reject, &invite_sig);

        let issuer = invoice.issuer.clone();
        invoice.status = Status::Rejected;
        invoice.reject_reason_hash = reason_hash.as_ref().map(to_hash32);

        self.invoices.insert(id, invoice);

        // Both sides are recorded: the issuer had an invoice rejected, and the caller
        // rejected one. The caller need not be a bound client, since rejecting never
        // binds one.
        self.bump_reputation(&issuer, |rep| rep.rejected_as_issuer += 1);
        self.bump_reputation(&who, |rep| rep.rejected_as_client += 1);
        Event::InvoiceRejected {
            invoice_id: id.into(),
            by: who,
        }
        .emit();
    }

    /// Replace the invite key, which kills the old link.
    ///
    /// For when an issuer loses the link or sent it to the wrong person. Issuer only, and
    /// only while `Issued`, so it can never be used to seize an invoice back from a
    /// client who has already accepted.
    pub fn rotate_invite(&mut self, id: U64, new_invite_pk: near_sdk::PublicKey) {
        let id = id.0;
        let mut invoice = self.require_invoice(id);

        self.assert_issuer(&invoice);
        self.assert_issued(&invoice);
        let _ = crate::types::ed25519_key_bytes(&new_invite_pk);

        invoice.invite_pk = new_invite_pk;
        self.invoices.insert(id, invoice);

        Event::InviteRotated {
            invoice_id: id.into(),
        }
        .emit();
    }
}

impl Contract {
    fn assert_not_issuer(&self, invoice: &crate::types::Invoice, who: &near_sdk::AccountId) {
        if who == &invoice.issuer {
            env::panic_str(E_ISSUER_CANNOT_ACT_AS_CLIENT);
        }
    }

    /// If the issuer named an expected client at mint, only that account may act, even
    /// with a valid signature. The invite signature is never bypassed by this check; it
    /// is an additional constraint on top.
    fn assert_expected_client(&self, invoice: &crate::types::Invoice, who: &near_sdk::AccountId) {
        if let Some(expected) = &invoice.client
            && expected != who
        {
            env::panic_str(E_NOT_EXPECTED_CLIENT);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;
    use near_sdk::PublicKey;

    const AMOUNT: u128 = 1_200_000_000;

    /// Mint an invoice and leave the context set to `who`.
    fn invoice_for(who: &str) -> (Contract, u64) {
        let (contract, id) = with_invoice(AMOUNT);
        set_context(who);
        (contract, id)
    }

    fn accept_as(contract: &mut Contract, id: u64, who: &str) {
        let sig = signed_for(contract, id, who, "accept");
        set_context(who);
        contract.accept_invoice(id.into(), sig);
    }

    // --- 41, 80: happy path, and the view round-trips through the verifier ---

    #[test]
    fn accepting_binds_the_caller_as_client() {
        let (mut contract, id) = invoice_for(CLIENT);
        accept_as(&mut contract, id, CLIENT);

        let invoice = contract.require_invoice(id);
        assert_eq!(invoice.status, Status::Accepted);
        assert_eq!(invoice.client, Some(acc(CLIENT)));
        assert_eq!(invoice.accepted_at, Some(NOW));

        let indexed: Vec<u64> = contract
            .by_client
            .get(&acc(CLIENT))
            .unwrap()
            .iter()
            .copied()
            .collect();
        assert_eq!(indexed, vec![id], "the client index is written on accept");
    }

    #[test]
    fn any_account_holding_the_link_can_accept() {
        // The issuer does not know the client's account id at mint, so whoever opens the
        // link binds themselves. That is the whole point of the invite key.
        let (mut contract, id) = invoice_for(STRANGER);
        accept_as(&mut contract, id, STRANGER);
        assert_eq!(contract.require_invoice(id).client, Some(acc(STRANGER)));
    }

    // --- 42: money can arrive before acceptance ---

    #[test]
    fn accepting_a_part_paid_invoice_lands_in_partially_paid() {
        let (mut contract, id) = invoice_for(CLIENT);
        if let Some(invoice) = contract.invoices.get_mut(&id) {
            invoice.paid = 500_000_000;
        }
        accept_as(&mut contract, id, CLIENT);

        let invoice = contract.require_invoice(id);
        assert_eq!(invoice.status, Status::PartiallyPaid);
        assert_eq!(
            invoice.paid, 500_000_000,
            "payment is neither lost nor re-applied"
        );
        assert_eq!(invoice.client, Some(acc(CLIENT)));
    }

    // --- 43, 48: malformed signatures ---

    #[test]
    #[should_panic(expected = "E_BAD_SIGNATURE")]
    fn rejects_a_garbage_signature() {
        let (mut contract, id) = invoice_for(CLIENT);
        contract.accept_invoice(id.into(), vec![0u8; 64].into());
    }

    #[test]
    #[should_panic(expected = "E_BAD_SIG_LENGTH")]
    fn rejects_a_short_signature() {
        let (mut contract, id) = invoice_for(CLIENT);
        contract.accept_invoice(id.into(), vec![0u8; 63].into());
    }

    #[test]
    #[should_panic(expected = "E_BAD_SIGNATURE")]
    fn rejects_a_signature_from_an_untrusted_key() {
        let (mut contract, id) = invoice_for(CLIENT);
        let message = contract.invite_message(id.into(), acc(CLIENT), "accept".to_string());
        // Correct message, wrong key.
        let sig: near_sdk::json_types::Base64VecU8 = sign(&other_signing_key(), &message).into();
        contract.accept_invoice(id.into(), sig);
    }

    // --- 44, 45, 46, 47: the four replay vectors the message binds against ---

    #[test]
    #[should_panic(expected = "E_BAD_SIGNATURE")]
    fn a_signature_for_another_invoice_does_not_transfer() {
        let mut contract = setup(OWNER);
        set_context_with_deposit(ISSUER, mint_deposit());
        let first = contract
            .create_invoice(
                invite_public_key(),
                acc(USDC),
                AMOUNT.into(),
                future_due().into(),
                vec![3u8; 32].into(),
                None,
            )
            .0;
        set_context_with_deposit(ISSUER, mint_deposit());
        let second = contract
            .create_invoice(
                invite_public_key(),
                acc(USDC),
                AMOUNT.into(),
                future_due().into(),
                vec![3u8; 32].into(),
                None,
            )
            .0;

        // Both invoices share an invite key here, which is the worst case. Binding the
        // invoice id is what stops one signature accepting the other.
        let sig = signed_for(&contract, first, CLIENT, "accept");
        set_context(CLIENT);
        contract.accept_invoice(second.into(), sig);
    }

    #[test]
    #[should_panic(expected = "E_BAD_SIGNATURE")]
    fn a_signature_cannot_be_front_run_by_another_account() {
        let (mut contract, id) = invoice_for(CLIENT);
        // The signature is public the moment it is in a pending transaction. Binding the
        // caller makes it worthless to anyone else.
        let sig = signed_for(&contract, id, CLIENT, "accept");
        set_context(STRANGER);
        contract.accept_invoice(id.into(), sig);
    }

    #[test]
    #[should_panic(expected = "E_BAD_SIGNATURE")]
    fn an_accept_signature_cannot_reject() {
        let (mut contract, id) = invoice_for(CLIENT);
        let sig = signed_for(&contract, id, CLIENT, "accept");
        set_context(CLIENT);
        contract.reject_invoice(id.into(), None, sig);
    }

    #[test]
    #[should_panic(expected = "E_BAD_SIGNATURE")]
    fn a_reject_signature_cannot_accept() {
        let (mut contract, id) = invoice_for(CLIENT);
        let sig = signed_for(&contract, id, CLIENT, "reject");
        set_context(CLIENT);
        contract.accept_invoice(id.into(), sig);
    }

    #[test]
    #[should_panic(expected = "E_BAD_SIGNATURE")]
    fn a_signature_for_another_contract_does_not_replay() {
        // A testnet signature must not work on mainnet, so the contract id is bound.
        let (mut contract, id) = invoice_for(CLIENT);
        let sig = signed_raw(&format!("ileri:v1:ileri.testnet:{id}:{CLIENT}:accept"));
        set_context(CLIENT);
        contract.accept_invoice(id.into(), sig);
    }

    #[test]
    #[should_panic(expected = "E_BAD_SIGNATURE")]
    fn a_signature_for_an_older_message_version_does_not_replay() {
        let (mut contract, id) = invoice_for(CLIENT);
        let sig = signed_raw(&format!("ileri:v0:{CONTRACT}:{id}:{CLIENT}:accept"));
        set_context(CLIENT);
        contract.accept_invoice(id.into(), sig);
    }

    // --- 49: the issuer is not a client ---

    #[test]
    #[should_panic(expected = "E_ISSUER_CANNOT_ACT_AS_CLIENT")]
    fn the_issuer_cannot_accept_their_own_invoice() {
        let (mut contract, id) = invoice_for(ISSUER);
        let sig = signed_for(&contract, id, ISSUER, "accept");
        set_context(ISSUER);
        contract.accept_invoice(id.into(), sig);
    }

    #[test]
    #[should_panic(expected = "E_ISSUER_CANNOT_ACT_AS_CLIENT")]
    fn the_issuer_cannot_reject_their_own_invoice() {
        let (mut contract, id) = invoice_for(ISSUER);
        let sig = signed_for(&contract, id, ISSUER, "reject");
        set_context(ISSUER);
        contract.reject_invoice(id.into(), None, sig);
    }

    // --- an expected client is enforced on top of the signature ---

    #[test]
    #[should_panic(expected = "E_NOT_EXPECTED_CLIENT")]
    fn a_named_client_cannot_be_substituted() {
        let mut contract = setup(OWNER);
        set_context_with_deposit(ISSUER, mint_deposit());
        let id = contract
            .create_invoice(
                invite_public_key(),
                acc(USDC),
                AMOUNT.into(),
                future_due().into(),
                vec![3u8; 32].into(),
                Some(acc(CLIENT)),
            )
            .0;
        // Valid signature for the stranger, but the invoice names someone else.
        let sig = signed_for(&contract, id, STRANGER, "accept");
        set_context(STRANGER);
        contract.accept_invoice(id.into(), sig);
    }

    #[test]
    fn a_named_client_can_still_accept() {
        let mut contract = setup(OWNER);
        set_context_with_deposit(ISSUER, mint_deposit());
        let id = contract
            .create_invoice(
                invite_public_key(),
                acc(USDC),
                AMOUNT.into(),
                future_due().into(),
                vec![3u8; 32].into(),
                Some(acc(CLIENT)),
            )
            .0;
        accept_as(&mut contract, id, CLIENT);
        assert_eq!(contract.require_invoice(id).status, Status::Accepted);
    }

    // --- 50 to 54: wrong state and unknown ids ---

    #[test]
    #[should_panic(expected = "E_NOT_ISSUED")]
    fn cannot_accept_twice() {
        let (mut contract, id) = invoice_for(CLIENT);
        accept_as(&mut contract, id, CLIENT);
        accept_as(&mut contract, id, CLIENT);
    }

    #[test]
    #[should_panic(expected = "E_NOT_ISSUED")]
    fn cannot_accept_a_rejected_invoice() {
        let (mut contract, id) = invoice_for(CLIENT);
        let sig = signed_for(&contract, id, CLIENT, "reject");
        set_context(CLIENT);
        contract.reject_invoice(id.into(), None, sig);
        accept_as(&mut contract, id, CLIENT);
    }

    #[test]
    #[should_panic(expected = "E_NOT_ISSUED")]
    fn cannot_reject_an_accepted_invoice() {
        let (mut contract, id) = invoice_for(CLIENT);
        accept_as(&mut contract, id, CLIENT);
        let sig = signed_for(&contract, id, CLIENT, "reject");
        set_context(CLIENT);
        contract.reject_invoice(id.into(), None, sig);
    }

    #[test]
    #[should_panic(expected = "E_NO_INVOICE")]
    fn cannot_accept_an_unknown_invoice() {
        let (mut contract, _id) = invoice_for(CLIENT);
        contract.accept_invoice(999.into(), vec![0u8; 64].into());
    }

    // --- 56, 57: reject ---

    #[test]
    fn rejecting_records_the_reason_hash() {
        let (mut contract, id) = invoice_for(CLIENT);
        let sig = signed_for(&contract, id, CLIENT, "reject");
        set_context(CLIENT);
        contract.reject_invoice(id.into(), Some(vec![5u8; 32].into()), sig);

        let invoice = contract.require_invoice(id);
        assert_eq!(invoice.status, Status::Rejected);
        assert_eq!(invoice.reject_reason_hash, Some([5u8; 32]));
        // Rejecting does not bind a client.
        assert_eq!(invoice.client, None);
    }

    #[test]
    fn rejecting_without_a_reason_is_allowed() {
        let (mut contract, id) = invoice_for(CLIENT);
        let sig = signed_for(&contract, id, CLIENT, "reject");
        set_context(CLIENT);
        contract.reject_invoice(id.into(), None, sig);
        assert_eq!(contract.require_invoice(id).reject_reason_hash, None);
    }

    #[test]
    #[should_panic(expected = "E_ALREADY_PAID_PART")]
    fn cannot_reject_once_money_has_arrived() {
        let (mut contract, id) = invoice_for(CLIENT);
        if let Some(invoice) = contract.invoices.get_mut(&id) {
            invoice.paid = 1;
        }
        let sig = signed_for(&contract, id, CLIENT, "reject");
        set_context(CLIENT);
        contract.reject_invoice(id.into(), None, sig);
    }

    // --- 55, 65 to 67: rotate_invite ---

    #[test]
    #[should_panic(expected = "E_BAD_SIGNATURE")]
    fn rotating_kills_the_old_link() {
        let (mut contract, id) = with_invoice(AMOUNT);
        // Captured before rotation, as a leaked link would be.
        let stale = signed_for(&contract, id, CLIENT, "accept");

        set_context(ISSUER);
        contract.rotate_invite(id.into(), near_public_key(&other_signing_key()));

        set_context(CLIENT);
        contract.accept_invoice(id.into(), stale);
    }

    #[test]
    fn rotating_makes_the_new_link_work() {
        let (mut contract, id) = with_invoice(AMOUNT);

        set_context(ISSUER);
        contract.rotate_invite(id.into(), near_public_key(&other_signing_key()));
        assert_eq!(
            contract.require_invoice(id).invite_pk,
            near_public_key(&other_signing_key())
        );

        let message = contract.invite_message(id.into(), acc(CLIENT), "accept".to_string());
        let fresh: near_sdk::json_types::Base64VecU8 = sign(&other_signing_key(), &message).into();
        set_context(CLIENT);
        contract.accept_invoice(id.into(), fresh);

        assert_eq!(contract.require_invoice(id).status, Status::Accepted);
        assert_eq!(contract.require_invoice(id).client, Some(acc(CLIENT)));
    }

    #[test]
    #[should_panic(expected = "E_NOT_ISSUER")]
    fn only_the_issuer_can_rotate() {
        let (mut contract, id) = invoice_for(STRANGER);
        contract.rotate_invite(id.into(), near_public_key(&other_signing_key()));
    }

    #[test]
    #[should_panic(expected = "E_NOT_ISSUED")]
    fn cannot_rotate_after_acceptance() {
        // Otherwise an issuer could seize an invoice back from a client who accepted.
        let (mut contract, id) = invoice_for(CLIENT);
        accept_as(&mut contract, id, CLIENT);
        set_context(ISSUER);
        contract.rotate_invite(id.into(), near_public_key(&other_signing_key()));
    }

    #[test]
    #[should_panic(expected = "E_BAD_INVITE_KEY")]
    fn cannot_rotate_to_a_non_ed25519_key() {
        let (mut contract, id) = invoice_for(ISSUER);
        let mut raw = vec![1u8];
        raw.extend_from_slice(&[9u8; 64]);
        contract.rotate_invite(id.into(), PublicKey::try_from(raw).unwrap());
    }
}
