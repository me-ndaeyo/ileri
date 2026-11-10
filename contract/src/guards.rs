//! Role and state assertions. Each one does a single check and names its own error.

use near_sdk::{AccountId, env};

use crate::Contract;
use crate::errors::{
    E_ALREADY_PAID_PART, E_NO_INVOICE, E_NOT_FINAL, E_NOT_HOLDER, E_NOT_ISSUED, E_NOT_ISSUER,
    E_NOT_OWNER,
};
use crate::types::{Invoice, Status};

/// The only sanctioned way to learn who is calling.
///
/// Always the predecessor, never the signer. Under NEP-366 meta transactions the
/// predecessor is still the user who signed the delegate action, so gasless calls need no
/// special handling, whereas `signer_account_id()` would name the relayer and hand it
/// everyone's permissions.
pub fn caller() -> AccountId {
    env::predecessor_account_id()
}

impl Contract {
    pub(crate) fn assert_owner(&self) {
        if caller() != self.owner_id {
            env::panic_str(E_NOT_OWNER);
        }
    }
}

impl Contract {
    /// Load an invoice or panic.
    ///
    /// Returns a clone on purpose. Handlers check and mutate the clone, then write it
    /// back with `invoices.insert`, which keeps `&mut self` free for the NFT and index
    /// collections in the same call. Invoices are a handful of account ids, so the copy
    /// is cheap next to the borrow gymnastics it avoids.
    pub(crate) fn require_invoice(&self, id: u64) -> Invoice {
        match self.invoices.get(&id) {
            Some(invoice) => invoice.clone(),
            None => env::panic_str(E_NO_INVOICE),
        }
    }

    pub(crate) fn assert_issuer(&self, invoice: &Invoice) {
        if caller() != invoice.issuer {
            env::panic_str(E_NOT_ISSUER);
        }
    }

    /// The current NFT holder, which is who payouts go to and who may sell or close a
    /// paid invoice. Not the issuer: an invoice that has been sold has a different holder.
    pub(crate) fn assert_holder(&self, id: u64) {
        match self.holder_of(id) {
            Some(holder) if holder == caller() => {}
            _ => env::panic_str(E_NOT_HOLDER),
        }
    }

    pub(crate) fn assert_issued(&self, invoice: &Invoice) {
        if invoice.status != Status::Issued {
            env::panic_str(E_NOT_ISSUED);
        }
    }

    /// Reject and cancel are only available while no money has arrived. Once a payment
    /// lands there is a payee with a claim, so the invoice can no longer be voided.
    pub(crate) fn assert_nothing_paid(&self, invoice: &Invoice) {
        if invoice.paid > 0 {
            env::panic_str(E_ALREADY_PAID_PART);
        }
    }

    pub(crate) fn assert_final(&self, invoice: &Invoice) {
        if !matches!(
            invoice.status,
            Status::Rejected | Status::Cancelled | Status::Paid
        ) {
            env::panic_str(E_NOT_FINAL);
        }
    }
}
