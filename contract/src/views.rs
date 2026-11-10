//! Read-only surface. Views never panic on missing data; they return `Option`.

use near_sdk::json_types::U64;
use near_sdk::{AccountId, env, near};

use crate::invite::{self, InviteAction};
use crate::{Contract, ContractExt};

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
}
