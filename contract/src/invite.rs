//! The invite signature: the one thing the contract and the browser must agree on
//! byte for byte.
//!
//! The issuer's browser generates a one-time ed25519 keypair, keeps the public half
//! onchain as `Invoice.invite_pk`, and puts the private half in the URL fragment of the
//! invite link. Whoever holds that link can prove it by signing, which is what authorises
//! accept and reject without the issuer knowing the client's account id in advance.
//!
//! The signed message binds four things, and each one closes a specific attack:
//!
//! | Field | Without it |
//! | --- | --- |
//! | contract id | a signature from testnet replays on mainnet |
//! | invoice id | one leaked signature accepts every invoice from that issuer |
//! | caller | anyone who sees the signature in a pending transaction front-runs it |
//! | action | an "accept" signature is replayed to reject, or the reverse |
//!
//! Account ids cannot contain `:`, and the invoice id is decimal digits, so the
//! colon-separated encoding is unambiguous: no two distinct tuples produce the same
//! string.

use near_sdk::json_types::Base64VecU8;
use near_sdk::{AccountId, env};

use crate::errors::{E_BAD_ACTION, E_BAD_SIGNATURE};
use crate::types::{Invoice, ed25519_key_bytes, to_sig64};

/// Bump if the message layout ever changes, so an old signature cannot be reinterpreted
/// under new rules.
const VERSION: &str = "v1";

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum InviteAction {
    Accept,
    Reject,
}

impl InviteAction {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            InviteAction::Accept => "accept",
            InviteAction::Reject => "reject",
        }
    }

    pub(crate) fn parse(raw: &str) -> Self {
        match raw {
            "accept" => InviteAction::Accept,
            "reject" => InviteAction::Reject,
            _ => env::panic_str(E_BAD_ACTION),
        }
    }
}

/// Build the exact message the invite key must sign.
///
/// Exposed as the `invite_message` view so the browser never reimplements this format and
/// therefore cannot drift from it.
pub(crate) fn message(
    contract_id: &AccountId,
    invoice_id: u64,
    caller: &AccountId,
    action: InviteAction,
) -> String {
    format!(
        "ileri:{VERSION}:{contract_id}:{invoice_id}:{caller}:{}",
        action.as_str()
    )
}

/// Panic unless `signature` is this invoice's invite key signing exactly
/// `(this contract, this invoice, this caller, this action)`.
pub(crate) fn verify(
    invoice: &Invoice,
    invoice_id: u64,
    caller: &AccountId,
    action: InviteAction,
    signature: &Base64VecU8,
) {
    let signature = to_sig64(signature);
    let key = ed25519_key_bytes(&invoice.invite_pk);
    let message = message(&env::current_account_id(), invoice_id, caller, action);

    if !env::ed25519_verify(&signature, message.as_bytes(), &key) {
        env::panic_str(E_BAD_SIGNATURE);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;
    use std::collections::HashSet;

    #[test]
    fn message_has_the_documented_shape() {
        let message = message(&acc(CONTRACT), 42, &acc(CLIENT), InviteAction::Accept);
        assert_eq!(message, "ileri:v1:ileri.near:42:client.near:accept");
    }

    /// The security argument rests on the encoding being injective: distinct tuples must
    /// never produce the same string. Account ids cannot contain `:` and invoice ids are
    /// decimal digits, so no field can bleed into the next.
    #[test]
    fn distinct_tuples_never_collide() {
        let contracts = [acc(CONTRACT), acc("ileri.testnet")];
        let ids = [1u64, 2, 12, 21, 112];
        let accounts = [acc(CLIENT), acc(STRANGER), acc("a.near")];
        let actions = [InviteAction::Accept, InviteAction::Reject];

        let mut seen = HashSet::new();
        let mut count = 0;
        for c in &contracts {
            for id in ids {
                for a in &accounts {
                    for action in actions {
                        count += 1;
                        assert!(
                            seen.insert(message(c, id, a, action)),
                            "collision at {c} {id} {a} {action:?}"
                        );
                    }
                }
            }
        }
        assert_eq!(seen.len(), count);
    }

    #[test]
    fn actions_round_trip() {
        assert_eq!(InviteAction::parse("accept"), InviteAction::Accept);
        assert_eq!(InviteAction::parse("reject"), InviteAction::Reject);
        assert_eq!(InviteAction::Accept.as_str(), "accept");
        assert_eq!(InviteAction::Reject.as_str(), "reject");
    }

    #[test]
    #[should_panic(expected = "E_BAD_ACTION")]
    fn unknown_actions_are_rejected() {
        InviteAction::parse("pay");
    }

    #[test]
    #[should_panic(expected = "E_BAD_ACTION")]
    fn action_matching_is_case_sensitive() {
        InviteAction::parse("Accept");
    }
}
