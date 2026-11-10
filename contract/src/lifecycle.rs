//! Issuer-driven lifecycle: minting an invoice, and later voiding or closing one.

use near_contract_standards::storage_management::ext_storage_management;
use near_sdk::json_types::{Base64VecU8, U64, U128};
use near_sdk::store::Vector;
use near_sdk::{AccountId, NearToken, Promise, PublicKey, env, near};

use crate::errors::{
    E_AMOUNT_ZERO, E_CLIENT_IS_ISSUER, E_DUE_DATE_PAST, E_NOT_HOLDER, E_TOKEN_NOT_ALLOWED,
};
use crate::events::Event;
use crate::gas::{FT_STORAGE_DEPOSIT, GAS_FT_STORAGE_DEPOSIT};
use crate::guards::caller;
use crate::storage::{StorageMeter, charge_and_refund};
use crate::types::{Invoice, Status, ed25519_key_bytes, to_hash32};
use crate::{Contract, ContractExt};

#[near]
impl Contract {
    /// Mint an invoice. The caller becomes the issuer and the first holder.
    ///
    /// `invite_pk` is the public half of a one-time keypair generated in the issuer's
    /// browser; the private half travels only in the URL fragment of the invite link and
    /// authorises accept and reject. The client's account id is therefore unknown at mint
    /// and gets bound by `accept_invoice`.
    ///
    /// `client` is optional and acts as a *constraint*, not a shortcut: if given, only
    /// that account may accept, and it must still present a valid invite signature. There
    /// is deliberately no second path to becoming the client.
    ///
    /// The attached deposit must cover this invoice's storage plus one NEP-145
    /// registration on the payment token. Any surplus is refunded.
    #[payable]
    pub fn create_invoice(
        &mut self,
        invite_pk: PublicKey,
        token: AccountId,
        amount: U128,
        due_date: U64,
        doc_hash: Base64VecU8,
        client: Option<AccountId>,
    ) -> U64 {
        let issuer = caller();
        let now = env::block_timestamp();

        if amount.0 == 0 {
            env::panic_str(E_AMOUNT_ZERO);
        }
        if due_date.0 <= now {
            env::panic_str(E_DUE_DATE_PAST);
        }
        if !self.allowed_tokens.contains(&token) {
            env::panic_str(E_TOKEN_NOT_ALLOWED);
        }
        if client.as_ref() == Some(&issuer) {
            env::panic_str(E_CLIENT_IS_ISSUER);
        }
        // Rejects a non-ed25519 key up front, so a bad invite key fails at mint rather
        // than leaving an invoice nobody can ever accept.
        let _ = ed25519_key_bytes(&invite_pk);
        let doc_hash = to_hash32(&doc_hash);

        let id = self.next_id;
        let meter = StorageMeter::start();
        self.next_id += 1;

        let invoice = Invoice {
            issuer: issuer.clone(),
            client,
            invite_pk,
            token: token.clone(),
            amount: amount.0,
            paid: 0,
            due_date: due_date.0,
            doc_hash,
            status: Status::Issued,
            created_at: now,
            accepted_at: None,
            paid_at: None,
            reject_reason_hash: None,
            storage_deposit: 0,
            listing: None,
        };

        self.invoices.insert(id, invoice);
        self.mint_invoice_nft(id, &issuer);
        self.push_issuer_index(&issuer, id);

        // Measure the invoice record, the NFT rows and the index entry together, then
        // charge once. Writing the measured cost back into the record cannot change the
        // measurement, because borsh encodes `u128` in a fixed 16 bytes whatever its
        // value, so the second insert is the same size as the first.
        let storage_cost = meter.cost();
        let required = storage_cost.saturating_add(FT_STORAGE_DEPOSIT.as_yoctonear());
        charge_and_refund(required);

        if let Some(invoice) = self.invoices.get_mut(&id) {
            invoice.storage_deposit = storage_cost;
        }

        self.bump_reputation(&issuer, |rep| rep.issued += 1);

        Event::InvoiceCreated {
            invoice_id: id.into(),
            issuer: issuer.clone(),
            token: token.clone(),
            amount,
            due_date,
        }
        .emit();

        // Register the issuer on the payment token so the first payout can be pushed
        // instead of landing in `claimable`. Detached on purpose: `registration_only`
        // makes the token refund the deposit if the account is already registered, and a
        // failure here costs nothing because `claimable` is still the backstop.
        ext_storage_management::ext(token)
            .with_attached_deposit(FT_STORAGE_DEPOSIT)
            .with_static_gas(GAS_FT_STORAGE_DEPOSIT)
            .storage_deposit(Some(issuer), Some(true))
            .detach();

        id.into()
    }

    /// Void an invoice the issuer no longer wants to send.
    ///
    /// Only while `Issued` and only before any money has arrived. Cancelling is a
    /// courtesy to the client, not a way to escape a payment already in flight.
    pub fn cancel_invoice(&mut self, id: U64) {
        let id = id.0;
        let mut invoice = self.require_invoice(id);

        self.assert_issuer(&invoice);
        self.assert_issued(&invoice);
        self.assert_nothing_paid(&invoice);

        let issuer = invoice.issuer.clone();
        invoice.status = Status::Cancelled;
        self.invoices.insert(id, invoice);

        self.bump_reputation(&issuer, |rep| rep.cancelled += 1);
        Event::InvoiceCancelled {
            invoice_id: id.into(),
            issuer,
        }
        .emit();
    }

    /// Close a finished invoice: burn the NFT, drop the record and return the storage
    /// deposit to the issuer who paid it.
    ///
    /// The issuer closes a `Rejected` or `Cancelled` invoice, since nothing was ever
    /// owed. The current *holder* closes a `Paid` one, because by then they may have
    /// bought it, and they are the party whose asset is being destroyed. The refund still
    /// goes to the issuer either way: they funded the storage.
    ///
    /// Removing the record is what makes the refund happen exactly once; a second call
    /// finds no invoice.
    pub fn close_invoice(&mut self, id: U64) {
        let id = id.0;
        let invoice = self.require_invoice(id);

        self.assert_final(&invoice);
        match invoice.status {
            Status::Paid => self.assert_holder(id),
            _ => self.assert_issuer(&invoice),
        }

        let holder = match self.holder_of(id) {
            Some(holder) => holder,
            None => env::panic_str(E_NOT_HOLDER),
        };

        self.burn_invoice_nft(id, &holder);
        self.invoices.remove(&id);
        self.listed.remove(&id);

        if invoice.storage_deposit > 0 {
            Promise::new(invoice.issuer.clone())
                .transfer(NearToken::from_yoctonear(invoice.storage_deposit))
                .detach();
        }

        Event::InvoiceClosed {
            invoice_id: id.into(),
            by: caller(),
        }
        .emit();
    }
}

impl Contract {
    pub(crate) fn push_issuer_index(&mut self, account: &AccountId, id: u64) {
        if let Some(ids) = self.by_issuer.get_mut(account) {
            ids.push(id);
            return;
        }
        let mut ids = Vector::new(Self::issuer_index_key(account));
        ids.push(id);
        self.by_issuer.insert(account.clone(), ids);
    }

    pub(crate) fn push_client_index(&mut self, account: &AccountId, id: u64) {
        if let Some(ids) = self.by_client.get_mut(account) {
            ids.push(id);
            return;
        }
        let mut ids = Vector::new(Self::client_index_key(account));
        ids.push(id);
        self.by_client.insert(account.clone(), ids);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;
    use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
    use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
    use near_sdk::NearToken;
    use near_sdk::test_utils::get_logs;

    const AMOUNT: u128 = 1_200_000_000; // 1,200.00 USDC at 6 decimals

    fn create(contract: &mut Contract, amount: u128, due: u64) -> u64 {
        contract
            .create_invoice(
                invite_public_key(),
                acc(USDC),
                amount.into(),
                due.into(),
                vec![3u8; 32].into(),
                None,
            )
            .0
    }

    // --- 28, 38, 39: happy path ---

    #[test]
    fn mints_an_issued_invoice_owned_by_the_issuer() {
        let (contract, id) = with_invoice(AMOUNT);
        let invoice = contract.require_invoice(id);

        assert_eq!(id, 1, "ids start at 1");
        assert_eq!(invoice.issuer, acc(ISSUER));
        assert_eq!(invoice.client, None, "client is unbound until accept");
        assert_eq!(invoice.token, acc(USDC));
        assert_eq!(invoice.amount, AMOUNT);
        assert_eq!(invoice.paid, 0);
        assert_eq!(invoice.status, Status::Issued);
        assert_eq!(invoice.created_at, NOW);
        assert_eq!(invoice.accepted_at, None);
        assert_eq!(invoice.paid_at, None);
        assert_eq!(invoice.doc_hash, [3u8; 32]);
        assert_eq!(invoice.listing, None);

        // The issuer is the first holder, so the first payout goes to them.
        assert_eq!(contract.holder_of(id), Some(acc(ISSUER)));
        assert_eq!(contract.nft_total_supply(), 1.into());
        let token = contract.nft_token(Contract::token_id_of(id)).unwrap();
        assert_eq!(token.owner_id, acc(ISSUER));
    }

    #[test]
    fn ids_are_sequential_and_indexed_per_issuer() {
        let mut contract = setup(OWNER);
        set_context_with_deposit(ISSUER, mint_deposit());
        assert_eq!(create(&mut contract, AMOUNT, future_due()), 1);
        assert_eq!(create(&mut contract, AMOUNT, future_due()), 2);
        assert_eq!(create(&mut contract, AMOUNT, future_due()), 3);
        assert_eq!(contract.get_next_invoice_id(), 4.into());
        assert_eq!(contract.nft_total_supply(), 3.into());

        let indexed: Vec<u64> = contract
            .by_issuer
            .get(&acc(ISSUER))
            .unwrap()
            .iter()
            .copied()
            .collect();
        assert_eq!(indexed, vec![1, 2, 3], "index keeps mint order");
    }

    #[test]
    fn nft_metadata_leaks_nothing_private() {
        let (contract, id) = with_invoice(AMOUNT);
        let metadata = contract
            .nft_token(Contract::token_id_of(id))
            .unwrap()
            .metadata
            .unwrap();

        assert_eq!(metadata.title, Some("Invoice #1".to_string()));
        assert_eq!(metadata.copies, Some(1));
        // No amount, no due date, no client, no link to the invoice file.
        assert_eq!(metadata.description, None);
        assert_eq!(metadata.extra, None);
        assert_eq!(metadata.reference, None);
        assert_eq!(metadata.media, None);
    }

    // --- 37: NEP-171 mint event ---

    #[test]
    fn emits_the_nep171_mint_event() {
        let (_contract, _id) = with_invoice(AMOUNT);
        let logs = get_logs();
        let event = logs
            .iter()
            .find(|l| l.contains("nft_mint"))
            .expect("an nft_mint event must be emitted");

        assert!(event.starts_with("EVENT_JSON:"), "NEP-297 prefix");
        assert!(event.contains("\"standard\":\"nep171\""));
        assert!(event.contains("\"owner_id\":\"issuer.near\""));
        assert!(event.contains("\"token_ids\":[\"1\"]"));
    }

    // --- 36: issuer is registered on the payment token ---

    #[test]
    fn registers_the_issuer_on_the_payment_token() {
        let (_contract, _id) = with_invoice(AMOUNT);

        let call = find_call("storage_deposit")
            .expect("a storage_deposit call must be scheduled on the token contract");

        assert_eq!(call.receiver, acc(USDC));
        assert_eq!(call.deposit, FT_STORAGE_DEPOSIT);
        // registration_only makes the token refund the remainder if already registered.
        assert_eq!(
            call.args,
            r#"{"account_id":"issuer.near","registration_only":true}"#
        );
    }

    // --- 35, 34: storage accounting ---

    #[test]
    fn the_deposit_splits_exactly_into_storage_registration_and_refund() {
        let (contract, id) = with_invoice(AMOUNT);
        let kept = contract.require_invoice(id).storage_deposit;

        let refunds: Vec<u128> = transfers()
            .into_iter()
            .filter(|(to, _)| to == &acc(ISSUER))
            .map(|(_, amount)| amount)
            .collect();
        assert_eq!(refunds.len(), 1, "exactly one refund to the issuer");

        // Nothing is kept beyond the measured storage and the one registration, and
        // nothing is lost: the three parts add up to what was attached.
        assert_eq!(
            kept + FT_STORAGE_DEPOSIT.as_yoctonear() + refunds[0],
            mint_deposit().as_yoctonear(),
        );
        assert!(kept > 0, "storage must be measured, not assumed");
    }

    #[test]
    #[should_panic(expected = "E_DEPOSIT_TOO_SMALL")]
    fn rejects_a_deposit_that_cannot_cover_storage() {
        let mut contract = setup(OWNER);
        // Enough for the bytes but not for the NEP-145 registration on top.
        set_context_with_deposit(ISSUER, NearToken::from_yoctonear(1));
        create(&mut contract, AMOUNT, future_due());
    }

    // --- 29, 30, 31, 32, 40: input validation ---

    #[test]
    #[should_panic(expected = "E_AMOUNT_ZERO")]
    fn rejects_zero_amount() {
        let mut contract = setup(OWNER);
        set_context_with_deposit(ISSUER, mint_deposit());
        create(&mut contract, 0, future_due());
    }

    #[test]
    #[should_panic(expected = "E_DUE_DATE_PAST")]
    fn rejects_a_due_date_in_the_past() {
        let mut contract = setup(OWNER);
        set_context_with_deposit(ISSUER, mint_deposit());
        create(&mut contract, AMOUNT, NOW - DAY);
    }

    #[test]
    #[should_panic(expected = "E_DUE_DATE_PAST")]
    fn rejects_a_due_date_of_exactly_now() {
        let mut contract = setup(OWNER);
        set_context_with_deposit(ISSUER, mint_deposit());
        create(&mut contract, AMOUNT, NOW);
    }

    #[test]
    #[should_panic(expected = "E_TOKEN_NOT_ALLOWED")]
    fn rejects_a_token_not_on_the_allowlist() {
        let mut contract = setup(OWNER);
        set_context_with_deposit(ISSUER, mint_deposit());
        contract.create_invoice(
            invite_public_key(),
            acc(OTHER_TOKEN),
            AMOUNT.into(),
            future_due().into(),
            vec![3u8; 32].into(),
            None,
        );
    }

    #[test]
    #[should_panic(expected = "E_CLIENT_IS_ISSUER")]
    fn rejects_billing_yourself() {
        let mut contract = setup(OWNER);
        set_context_with_deposit(ISSUER, mint_deposit());
        contract.create_invoice(
            invite_public_key(),
            acc(USDC),
            AMOUNT.into(),
            future_due().into(),
            vec![3u8; 32].into(),
            Some(acc(ISSUER)),
        );
    }

    #[test]
    #[should_panic(expected = "E_BAD_DOC_HASH")]
    fn rejects_a_doc_hash_that_is_not_32_bytes() {
        let mut contract = setup(OWNER);
        set_context_with_deposit(ISSUER, mint_deposit());
        contract.create_invoice(
            invite_public_key(),
            acc(USDC),
            AMOUNT.into(),
            future_due().into(),
            vec![3u8; 31].into(),
            None,
        );
    }

    #[test]
    #[should_panic(expected = "E_BAD_INVITE_KEY")]
    fn rejects_a_non_ed25519_invite_key() {
        let mut contract = setup(OWNER);
        set_context_with_deposit(ISSUER, mint_deposit());
        // Curve type 1 is secp256k1, with a 64-byte body.
        let mut raw = vec![1u8];
        raw.extend_from_slice(&[9u8; 64]);
        contract.create_invoice(
            near_sdk::PublicKey::try_from(raw).unwrap(),
            acc(USDC),
            AMOUNT.into(),
            future_due().into(),
            vec![3u8; 32].into(),
            None,
        );
    }

    #[test]
    fn an_expected_client_is_recorded_as_a_constraint() {
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
        // Recorded, but acceptance still requires a valid invite signature.
        assert_eq!(contract.require_invoice(id).client, Some(acc(CLIENT)));
        assert_eq!(contract.require_invoice(id).accepted_at, None);
        assert_eq!(contract.require_invoice(id).status, Status::Issued);
    }

    // --- a freshly minted invoice is not yet tradable ---

    #[test]
    #[should_panic(expected = "E_NOT_TRADABLE")]
    fn an_issued_invoice_cannot_be_transferred() {
        // Before the client accepts there is no agreed obligation for a buyer to rely on.
        let (mut contract, id) = with_invoice(AMOUNT);
        set_context_with_deposit(ISSUER, NearToken::from_yoctonear(1));
        contract.nft_transfer(acc(STRANGER), Contract::token_id_of(id), None, None);
    }

    #[test]
    #[should_panic(expected = "E_NOT_TRADABLE")]
    fn an_issued_invoice_cannot_be_transferred_with_a_call() {
        let (mut contract, id) = with_invoice(AMOUNT);
        set_context_with_deposit(ISSUER, NearToken::from_yoctonear(1));
        let _ = contract.nft_transfer_call(
            acc(STRANGER),
            Contract::token_id_of(id),
            None,
            None,
            String::new(),
        );
    }

    #[test]
    fn missing_invoice_panics() {
        let (contract, _id) = with_invoice(AMOUNT);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.require_invoice(999)
        }));
        assert!(result.is_err(), "unknown ids must not resolve");
    }

    // --- 61 to 64: cancel ---

    #[test]
    fn the_issuer_can_cancel_an_unpaid_issued_invoice() {
        let (mut contract, id) = with_invoice(AMOUNT);
        set_context(ISSUER);
        contract.cancel_invoice(id.into());
        assert_eq!(contract.require_invoice(id).status, Status::Cancelled);
    }

    #[test]
    #[should_panic(expected = "E_NOT_ISSUER")]
    fn a_stranger_cannot_cancel() {
        let (mut contract, id) = with_invoice(AMOUNT);
        set_context(STRANGER);
        contract.cancel_invoice(id.into());
    }

    #[test]
    #[should_panic(expected = "E_NOT_ISSUER")]
    fn the_client_cannot_cancel() {
        let (mut contract, id) = with_invoice(AMOUNT);
        set_context(CLIENT);
        contract.cancel_invoice(id.into());
    }

    #[test]
    #[should_panic(expected = "E_ALREADY_PAID_PART")]
    fn cannot_cancel_once_money_has_arrived() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Issued, 1);
        set_context(ISSUER);
        contract.cancel_invoice(id.into());
    }

    #[test]
    #[should_panic(expected = "E_NOT_ISSUED")]
    fn cannot_cancel_a_cancelled_invoice() {
        let (mut contract, id) = with_invoice(AMOUNT);
        set_context(ISSUER);
        contract.cancel_invoice(id.into());
        contract.cancel_invoice(id.into());
    }

    #[test]
    #[should_panic(expected = "E_NOT_ISSUED")]
    fn cannot_cancel_an_accepted_invoice() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);
        set_context(ISSUER);
        contract.cancel_invoice(id.into());
    }

    // --- 68 to 74: close ---

    fn assert_burned(contract: &Contract, id: u64) {
        assert_eq!(contract.nft_total_supply(), 0.into());
        assert!(contract.nft_token(Contract::token_id_of(id)).is_none());
        assert!(contract.holder_of(id).is_none());
        assert!(
            contract
                .nft_tokens_for_owner(acc(ISSUER), None, None)
                .is_empty(),
            "the per-owner index must not keep a dangling entry"
        );
    }

    #[test]
    fn the_issuer_closes_a_cancelled_invoice_and_gets_the_storage_back() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let deposit = contract.require_invoice(id).storage_deposit;

        set_context(ISSUER);
        contract.cancel_invoice(id.into());
        contract.close_invoice(id.into());

        assert_burned(&contract, id);
        assert!(contract.invoices.get(&id).is_none(), "the record is gone");

        let refunds: Vec<u128> = transfers()
            .into_iter()
            .filter(|(to, _)| to == &acc(ISSUER))
            .map(|(_, amount)| amount)
            .collect();
        assert_eq!(refunds, vec![deposit], "exactly the measured storage, once");
    }

    #[test]
    fn the_issuer_closes_a_rejected_invoice() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Rejected, 0);
        set_context(ISSUER);
        contract.close_invoice(id.into());
        assert_burned(&contract, id);
    }

    #[test]
    fn the_holder_closes_a_paid_invoice_and_the_issuer_is_still_refunded() {
        let (mut contract, id) = with_invoice(AMOUNT);
        let deposit = contract.require_invoice(id).storage_deposit;
        force_status(&mut contract, id, Status::Paid, AMOUNT);

        // The issuer is still the holder here, having never sold it.
        set_context(ISSUER);
        contract.close_invoice(id.into());

        assert_burned(&contract, id);
        let refunds: Vec<u128> = transfers()
            .into_iter()
            .filter(|(to, _)| to == &acc(ISSUER))
            .map(|(_, amount)| amount)
            .collect();
        assert_eq!(
            refunds,
            vec![deposit],
            "storage goes back to whoever funded it"
        );
    }

    #[test]
    #[should_panic(expected = "E_NOT_HOLDER")]
    fn a_non_holder_cannot_close_a_paid_invoice() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Paid, AMOUNT);
        set_context(STRANGER);
        contract.close_invoice(id.into());
    }

    #[test]
    #[should_panic(expected = "E_NOT_ISSUER")]
    fn a_non_issuer_cannot_close_a_cancelled_invoice() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Cancelled, 0);
        set_context(STRANGER);
        contract.close_invoice(id.into());
    }

    #[test]
    #[should_panic(expected = "E_NOT_FINAL")]
    fn cannot_close_an_issued_invoice() {
        let (mut contract, id) = with_invoice(AMOUNT);
        set_context(ISSUER);
        contract.close_invoice(id.into());
    }

    #[test]
    #[should_panic(expected = "E_NOT_FINAL")]
    fn cannot_close_a_part_paid_invoice() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::PartiallyPaid, 1);
        set_context(ISSUER);
        contract.close_invoice(id.into());
    }

    #[test]
    #[should_panic(expected = "E_NO_INVOICE")]
    fn the_storage_refund_cannot_be_claimed_twice() {
        let (mut contract, id) = with_invoice(AMOUNT);
        set_context(ISSUER);
        contract.cancel_invoice(id.into());
        contract.close_invoice(id.into());
        // The record is gone, so there is nothing left to refund against.
        contract.close_invoice(id.into());
    }

    #[test]
    fn closing_one_invoice_leaves_the_others_alone() {
        let mut contract = setup(OWNER);
        set_context_with_deposit(ISSUER, mint_deposit());
        let first = create(&mut contract, AMOUNT, future_due());
        set_context_with_deposit(ISSUER, mint_deposit());
        let second = create(&mut contract, AMOUNT, future_due());

        set_context(ISSUER);
        contract.cancel_invoice(first.into());
        contract.close_invoice(first.into());

        assert!(contract.invoices.get(&first).is_none());
        assert_eq!(contract.require_invoice(second).status, Status::Issued);
        assert_eq!(contract.nft_total_supply(), 1.into());
        assert_eq!(contract.holder_of(second), Some(acc(ISSUER)));
        // The index is append-only, so the closed id stays and views skip it.
        let indexed: Vec<u64> = contract
            .by_issuer
            .get(&acc(ISSUER))
            .unwrap()
            .iter()
            .copied()
            .collect();
        assert_eq!(indexed, vec![first, second]);
    }
}
