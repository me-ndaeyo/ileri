//! Read-only surface.
//!
//! Views never panic on missing data; they return `Option` or an empty page. Only
//! state-changing methods panic.
//!
//! Every invoice view reports `status` with `Overdue` derived at read time rather than
//! stored, so an invoice that runs late and is then paid needs no corrective write and no
//! keeper bot.

use near_sdk::json_types::{U64, U128};
use near_sdk::store::Vector;
use near_sdk::{AccountId, env, near};

use crate::invite::{self, InviteAction};
use crate::types::{Invoice, InvoiceView};
use crate::{Contract, ContractExt};

/// Page size when the caller does not say. Views run under the gas limit of whoever calls
/// them, so pages are bounded by default and capped absolutely.
const DEFAULT_PAGE_LIMIT: u64 = 50;
const MAX_PAGE_LIMIT: u64 = 200;

#[near]
impl Contract {
    /// The exact message an invite key must sign for `action` on this invoice.
    ///
    /// Published so the browser signs what the contract will verify rather than
    /// reconstructing the format and risking drift. `action` is `"accept"` or `"reject"`.
    pub fn invite_message(&self, id: U64, account: AccountId, action: String) -> String {
        invite::message(
            &env::current_account_id(),
            id.0,
            &account,
            InviteAction::parse(&action),
        )
    }

    pub fn get_invoice(&self, id: U64) -> Option<InvoiceView> {
        self.invoices
            .get(&id.0)
            .map(|invoice| self.invoice_view(id.0, invoice))
    }

    /// Invoices this account issued, oldest first.
    pub fn invoices_for_issuer(
        &self,
        account_id: AccountId,
        from_index: Option<U64>,
        limit: Option<u64>,
    ) -> Vec<InvoiceView> {
        self.page(self.by_issuer.get(&account_id), from_index, limit)
    }

    /// Invoices this account accepted as the client, oldest first.
    pub fn invoices_for_client(
        &self,
        account_id: AccountId,
        from_index: Option<U64>,
        limit: Option<u64>,
    ) -> Vec<InvoiceView> {
        self.page(self.by_client.get(&account_id), from_index, limit)
    }

    /// How many invoices have ever been minted, closed ones included.
    pub fn get_invoice_count(&self) -> U64 {
        u64::from(self.invoices.len()).into()
    }
}

impl Contract {
    /// Build the external view of an invoice, deriving `Overdue`, `unpaid` and the current
    /// holder so no caller has to reimplement those rules.
    fn invoice_view(&self, id: u64, invoice: &Invoice) -> InvoiceView {
        InvoiceView {
            id: id.into(),
            issuer: invoice.issuer.clone(),
            client: invoice.client.clone(),
            invite_pk: invoice.invite_pk.clone(),
            holder: self.holder_of(id),
            token: invoice.token.clone(),
            amount: U128(invoice.amount),
            paid: U128(invoice.paid),
            unpaid: U128(invoice.unpaid()),
            due_date: invoice.due_date.into(),
            doc_hash: invoice.doc_hash.to_vec().into(),
            status: invoice.status_view(env::block_timestamp()),
            stored_status: invoice.status,
            created_at: invoice.created_at.into(),
            accepted_at: invoice.accepted_at.map(Into::into),
            paid_at: invoice.paid_at.map(Into::into),
            reject_reason_hash: invoice.reject_reason_hash.map(|hash| hash.to_vec().into()),
            listing: invoice.listing.map(U128),
        }
    }

    /// One page of an index.
    ///
    /// Indexes are append-only, so a closed invoice leaves its id behind. Ids that no
    /// longer resolve are skipped, which means a page can return fewer rows than `limit`
    /// without that meaning the end of the list.
    fn page(
        &self,
        ids: Option<&Vector<u64>>,
        from_index: Option<U64>,
        limit: Option<u64>,
    ) -> Vec<InvoiceView> {
        let Some(ids) = ids else {
            return Vec::new();
        };
        let from = from_index.map(|from| from.0).unwrap_or(0);
        let limit = limit.unwrap_or(DEFAULT_PAGE_LIMIT).min(MAX_PAGE_LIMIT);

        ids.iter()
            .skip(from as usize)
            .take(limit as usize)
            .filter_map(|id| {
                self.invoices
                    .get(id)
                    .map(|invoice| self.invoice_view(*id, invoice))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;
    use crate::types::{Status, StatusView};

    const AMOUNT: u128 = 1_200_000_000;

    // --- 75: missing data ---

    #[test]
    fn views_return_nothing_rather_than_panicking() {
        let (contract, _id) = with_invoice(AMOUNT);
        assert!(contract.get_invoice(999.into()).is_none());
        assert!(
            contract
                .invoices_for_issuer(acc(STRANGER), None, None)
                .is_empty()
        );
        assert!(
            contract
                .invoices_for_client(acc(STRANGER), None, None)
                .is_empty()
        );
        assert_eq!(contract.get_claimable(acc(STRANGER), acc(USDC)).0, 0);
    }

    // --- the view derives what callers would otherwise reimplement ---

    #[test]
    fn the_view_reports_holder_unpaid_and_base64_hash() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 200_000_000);

        let view = contract.get_invoice(id.into()).unwrap();
        assert_eq!(view.id, id.into());
        assert_eq!(view.holder, Some(acc(ISSUER)));
        assert_eq!(view.amount.0, AMOUNT);
        assert_eq!(view.paid.0, 200_000_000);
        assert_eq!(view.unpaid.0, 1_000_000_000);
        assert_eq!(view.doc_hash.0, vec![3u8; 32]);
        assert_eq!(view.stored_status, Status::Accepted);
        assert_eq!(view.listing, None);
    }

    #[test]
    fn the_view_follows_the_nft_holder() {
        let (mut contract, id) = with_invoice(AMOUNT);
        contract.nft.internal_transfer_unguarded(
            &Contract::token_id_of(id),
            &acc(ISSUER),
            &acc(STRANGER),
        );
        let view = contract.get_invoice(id.into()).unwrap();
        assert_eq!(view.holder, Some(acc(STRANGER)));
        assert_eq!(view.issuer, acc(ISSUER), "the issuer never changes");
    }

    // --- 76, 77, 78: Overdue is derived, never stored ---

    #[test]
    fn an_accepted_invoice_past_due_reads_as_overdue() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);

        set_context_at(STRANGER, future_due() + DAY);
        let view = contract.get_invoice(id.into()).unwrap();

        assert_eq!(view.status, StatusView::Overdue);
        assert_eq!(
            view.stored_status,
            Status::Accepted,
            "storage is untouched, so being paid later needs no corrective write"
        );
    }

    #[test]
    fn a_part_paid_invoice_past_due_reads_as_overdue() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::PartiallyPaid, 500_000_000);

        set_context_at(STRANGER, future_due() + DAY);
        assert_eq!(
            contract.get_invoice(id.into()).unwrap().status,
            StatusView::Overdue
        );
    }

    #[test]
    fn an_unaccepted_invoice_past_due_is_not_overdue() {
        // Nobody has agreed to it, so there is no obligation to be late on.
        let (contract, id) = with_invoice(AMOUNT);
        set_context_at(STRANGER, future_due() + DAY);
        assert_eq!(
            contract.get_invoice(id.into()).unwrap().status,
            StatusView::Issued
        );
    }

    #[test]
    fn settled_and_void_invoices_are_never_overdue() {
        // One contract, one invoice, status swapped in place: `testing_env!` carries the
        // mocked storage across calls, so a second `init` in the same test would collide
        // on token_id.
        let (mut contract, id) = with_invoice(AMOUNT);
        for (status, expected) in [
            (Status::Paid, StatusView::Paid),
            (Status::Rejected, StatusView::Rejected),
            (Status::Cancelled, StatusView::Cancelled),
        ] {
            force_status(&mut contract, id, status, 0);
            set_context_at(STRANGER, future_due() + 365 * DAY);
            assert_eq!(
                contract.get_invoice(id.into()).unwrap().status,
                expected,
                "{status:?} must not read as overdue however late"
            );
        }
    }

    #[test]
    fn an_invoice_before_its_due_date_is_not_overdue() {
        let (mut contract, id) = with_invoice(AMOUNT);
        force_status(&mut contract, id, Status::Accepted, 0);
        set_context_at(STRANGER, future_due() - DAY);
        assert_eq!(
            contract.get_invoice(id.into()).unwrap().status,
            StatusView::Accepted
        );
    }

    // --- 79: pagination ---

    fn mint_many(contract: &mut Contract, count: u64) -> Vec<u64> {
        (0..count)
            .map(|_| {
                set_context_with_deposit(ISSUER, mint_deposit());
                contract
                    .create_invoice(
                        invite_public_key(),
                        acc(USDC),
                        AMOUNT.into(),
                        future_due().into(),
                        vec![3u8; 32].into(),
                        None,
                    )
                    .0
            })
            .collect()
    }

    #[test]
    fn the_issuer_index_pages_in_mint_order() {
        let mut contract = setup(OWNER);
        let ids = mint_many(&mut contract, 5);

        let all = contract.invoices_for_issuer(acc(ISSUER), None, None);
        assert_eq!(all.len(), 5);
        assert_eq!(
            all.iter().map(|v| v.id.0).collect::<Vec<_>>(),
            ids,
            "oldest first"
        );

        let first_two = contract.invoices_for_issuer(acc(ISSUER), None, Some(2));
        assert_eq!(
            first_two.iter().map(|v| v.id.0).collect::<Vec<_>>(),
            ids[..2]
        );

        let middle = contract.invoices_for_issuer(acc(ISSUER), Some(2.into()), Some(2));
        assert_eq!(middle.iter().map(|v| v.id.0).collect::<Vec<_>>(), ids[2..4]);

        let past_end = contract.invoices_for_issuer(acc(ISSUER), Some(99.into()), None);
        assert!(
            past_end.is_empty(),
            "reading past the end is empty, not an error"
        );
    }

    #[test]
    fn a_closed_invoice_drops_out_of_its_page() {
        // Indexes are append-only, so the id stays but no longer resolves. A short page
        // therefore does not mean the end of the list.
        let mut contract = setup(OWNER);
        let ids = mint_many(&mut contract, 3);

        set_context(ISSUER);
        contract.cancel_invoice(ids[1].into());
        contract.close_invoice(ids[1].into());

        let page = contract.invoices_for_issuer(acc(ISSUER), None, None);
        assert_eq!(
            page.iter().map(|v| v.id.0).collect::<Vec<_>>(),
            vec![ids[0], ids[2]],
            "the closed invoice is skipped, the order of the rest is kept"
        );
    }

    #[test]
    fn the_client_index_fills_on_acceptance() {
        let (mut contract, id) = with_invoice(AMOUNT);
        assert!(
            contract
                .invoices_for_client(acc(CLIENT), None, None)
                .is_empty()
        );

        let sig = signed_for(&contract, id, CLIENT, "accept");
        set_context(CLIENT);
        contract.accept_invoice(id.into(), sig);

        let page = contract.invoices_for_client(acc(CLIENT), None, None);
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].id.0, id);
        assert_eq!(page[0].client, Some(acc(CLIENT)));
        assert_eq!(page[0].status, StatusView::Accepted);
    }

    #[test]
    fn an_oversized_limit_is_capped() {
        let mut contract = setup(OWNER);
        mint_many(&mut contract, 3);
        // The cap protects a view from being asked for more than it can return in gas.
        let page = contract.invoices_for_issuer(acc(ISSUER), None, Some(u64::MAX));
        assert_eq!(page.len(), 3);
    }

    #[test]
    fn the_invoice_count_tracks_live_records() {
        let mut contract = setup(OWNER);
        let ids = mint_many(&mut contract, 3);
        assert_eq!(contract.get_invoice_count(), 3.into());

        set_context(ISSUER);
        contract.cancel_invoice(ids[0].into());
        contract.close_invoice(ids[0].into());
        assert_eq!(contract.get_invoice_count(), 2.into());
    }
}
