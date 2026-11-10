//! Every panic message the contract can produce, in one place.
//!
//! Each message starts with a stable `E_*` code followed by prose. Tests assert on the
//! code via `#[should_panic(expected = "E_NOT_ISSUER")]`, never on the prose, so wording
//! can be improved freely while a changed *code* is a deliberate, visible break.

// Initialization and admin
pub const E_NOT_OWNER: &str = "E_NOT_OWNER: only the contract owner can change the token allowlist";
pub const E_TOKEN_ALREADY_ALLOWED: &str =
    "E_TOKEN_ALREADY_ALLOWED: token is already on the allowlist";
pub const E_TOKEN_NOT_ALLOWED: &str = "E_TOKEN_NOT_ALLOWED: token is not on the payment allowlist";

// Invoice creation
pub const E_AMOUNT_ZERO: &str = "E_AMOUNT_ZERO: amount must be greater than zero";
pub const E_DUE_DATE_PAST: &str = "E_DUE_DATE_PAST: due date must be in the future";
pub const E_CLIENT_IS_ISSUER: &str = "E_CLIENT_IS_ISSUER: the client cannot be the issuer";
pub const E_BAD_INVITE_KEY: &str = "E_BAD_INVITE_KEY: invite public key must be ed25519";
pub const E_BAD_DOC_HASH: &str = "E_BAD_DOC_HASH: doc hash must be 32 bytes";
pub const E_DEPOSIT_TOO_SMALL: &str =
    "E_DEPOSIT_TOO_SMALL: attached deposit does not cover storage";

// Lookup and roles
pub const E_NO_INVOICE: &str = "E_NO_INVOICE: no invoice with that id";
pub const E_NOT_ISSUER: &str = "E_NOT_ISSUER: only the issuer can do this";
pub const E_NOT_HOLDER: &str = "E_NOT_HOLDER: only the current holder can do this";
pub const E_NOT_EXPECTED_CLIENT: &str =
    "E_NOT_EXPECTED_CLIENT: this invoice names a different client";
pub const E_ISSUER_CANNOT_ACT_AS_CLIENT: &str =
    "E_ISSUER_CANNOT_ACT_AS_CLIENT: the issuer cannot accept or reject their own invoice";

// State machine
pub const E_NOT_ISSUED: &str = "E_NOT_ISSUED: invoice is no longer in the issued state";
pub const E_ALREADY_PAID_PART: &str = "E_ALREADY_PAID_PART: invoice has already received payment";
pub const E_NOT_FINAL: &str = "E_NOT_FINAL: invoice is not in a final state";

// Invite signature
pub const E_BAD_SIG_LENGTH: &str = "E_BAD_SIG_LENGTH: invite signature must be 64 bytes";
pub const E_BAD_SIGNATURE: &str =
    "E_BAD_SIGNATURE: invite signature does not match this invoice and caller";
pub const E_BAD_ACTION: &str = "E_BAD_ACTION: action must be accept or reject";

// Payments and payouts
pub const E_NOTHING_CLAIMABLE: &str = "E_NOTHING_CLAIMABLE: no claimable balance for that token";

// Marketplace
pub const E_NOT_TRADABLE: &str =
    "E_NOT_TRADABLE: an invoice can only change hands once accepted and before it is fully paid";
pub const E_PRICE_ZERO: &str = "E_PRICE_ZERO: price must be greater than zero";
pub const E_PRICE_TOO_HIGH: &str =
    "E_PRICE_TOO_HIGH: price must be below the unpaid balance, or nobody should buy it";
pub const E_NOT_LISTED: &str = "E_NOT_LISTED: invoice is not for sale";
pub const E_ALREADY_LISTED: &str = "E_ALREADY_LISTED: invoice is already for sale";

// NFT
// There is deliberately no approvals error: NEP-178 is disabled by constructing the
// token with no approval prefix, so no code path exists that could reject an approval.

// Arithmetic
pub const E_OVERFLOW: &str = "E_OVERFLOW: arithmetic overflow";
pub const E_UNDERFLOW: &str = "E_UNDERFLOW: arithmetic underflow";
