//! Role and state assertions. Each one does a single check and names its own error.

use near_sdk::{AccountId, env};

use crate::Contract;
use crate::errors::E_NOT_OWNER;

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
