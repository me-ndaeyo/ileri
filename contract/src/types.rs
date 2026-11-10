//! Domain model and the DTOs that cross the ABI.
//!
//! The split is deliberate and load-bearing. [`Invoice`] is borsh-only and holds raw
//! `u128` and `[u8; 32]`. [`InvoiceView`] is json-only and holds `U128`, `U64` and
//! `Base64VecU8`. Storage types never reach the ABI and view types never reach storage,
//! which is what lets "Overdue is computed at read time" be a plain function rather than
//! a special case in the state machine.

use near_sdk::json_types::{Base64VecU8, U64, U128};
use near_sdk::{AccountId, PublicKey, near};

use crate::errors::{E_BAD_DOC_HASH, E_BAD_INVITE_KEY, E_BAD_SIG_LENGTH};
use near_sdk::env;

/// Stored status. `Overdue` is intentionally absent: it is derived, never written, so an
/// overdue invoice that later gets paid needs no corrective write.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Issued,
    Accepted,
    Rejected,
    Cancelled,
    PartiallyPaid,
    Paid,
}

/// Status as views report it: [`Status`] plus the computed `Overdue`.
#[near(serializers = [json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum StatusView {
    Issued,
    Accepted,
    Rejected,
    Cancelled,
    PartiallyPaid,
    Paid,
    Overdue,
}

/// One invoice. Paired one-to-one with an NFT whose `token_id` is the invoice id as a
/// decimal string.
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Invoice {
    pub issuer: AccountId,
    /// `None` until the client accepts. The issuer does not know the client's account id
    /// when the invoice is minted; it is bound by `accept_invoice`.
    pub client: Option<AccountId>,
    /// ed25519 key from the invite link. Authorises accept and reject.
    pub invite_pk: PublicKey,
    pub token: AccountId,
    pub amount: u128,
    pub paid: u128,
    /// Nanoseconds, matching `env::block_timestamp()`.
    pub due_date: u64,
    pub doc_hash: [u8; 32],
    pub status: Status,
    pub created_at: u64,
    pub accepted_at: Option<u64>,
    pub paid_at: Option<u64>,
    pub reject_reason_hash: Option<[u8; 32]>,
    /// Yocto kept at mint to cover this invoice's storage, refunded once on close.
    pub storage_deposit: u128,
    /// Sale price in `token`. `None` means not for sale. Wired in build step 2.
    pub listing: Option<u128>,
}

impl Invoice {
    pub fn unpaid(&self) -> u128 {
        crate::math::sub(self.amount, self.paid)
    }

    pub fn is_fully_paid(&self) -> bool {
        self.paid >= self.amount
    }

    /// Payable means a payment can still be applied. An invoice can take money before the
    /// client accepts; it just cannot be traded until then.
    pub fn is_payable(&self) -> bool {
        matches!(
            self.status,
            Status::Issued | Status::Accepted | Status::PartiallyPaid
        )
    }

    /// Only `Accepted` and `PartiallyPaid` can run overdue. `Issued` has not been agreed
    /// to yet, and `Paid` is done.
    pub fn status_view(&self, now: u64) -> StatusView {
        match self.status {
            Status::Accepted if now > self.due_date => StatusView::Overdue,
            Status::PartiallyPaid if now > self.due_date => StatusView::Overdue,
            Status::Issued => StatusView::Issued,
            Status::Accepted => StatusView::Accepted,
            Status::Rejected => StatusView::Rejected,
            Status::Cancelled => StatusView::Cancelled,
            Status::PartiallyPaid => StatusView::PartiallyPaid,
            Status::Paid => StatusView::Paid,
        }
    }
}

/// Plain counters, no score and no formula. The app shows the raw numbers and buyers
/// judge for themselves. Wired in build step 2.
#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct Rep {
    pub issued: u64,
    pub rejected_as_issuer: u64,
    pub cancelled: u64,
    pub accepted_as_client: u64,
    pub rejected_as_client: u64,
    pub paid_on_time: u64,
    pub paid_late: u64,
}

/// The `msg` carried by `ft_transfer_call`, e.g. `{"action":"pay","invoice_id":"42"}`.
/// `U64` serialises as a JSON string, so ids stay JS-safe and parse straight from the
/// wire format 1Click sends.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum TransferMsg {
    Pay {
        invoice_id: U64,
    },
    /// Accepted by the parser in step 1 but refunded; the marketplace lands in step 2.
    Buy {
        invoice_id: U64,
    },
}

/// Everything a caller needs about an invoice, with derived fields precomputed so no
/// client has to reimplement the rules.
#[near(serializers = [json])]
#[derive(Clone)]
pub struct InvoiceView {
    pub id: U64,
    pub issuer: AccountId,
    pub client: Option<AccountId>,
    pub invite_pk: PublicKey,
    /// Current NFT owner, and therefore who the next payment goes to.
    pub holder: Option<AccountId>,
    pub token: AccountId,
    pub amount: U128,
    pub paid: U128,
    pub unpaid: U128,
    pub due_date: U64,
    pub doc_hash: Base64VecU8,
    /// Includes the computed `Overdue`.
    pub status: StatusView,
    /// What is actually in storage, for debugging and for clients that need the raw value.
    pub stored_status: Status,
    pub created_at: U64,
    pub accepted_at: Option<U64>,
    pub paid_at: Option<U64>,
    pub reject_reason_hash: Option<Base64VecU8>,
    pub listing: Option<U128>,
}

/// Decode a 32-byte hash arriving as base64.
pub fn to_hash32(bytes: &Base64VecU8) -> [u8; 32] {
    match <[u8; 32]>::try_from(bytes.0.as_slice()) {
        Ok(h) => h,
        Err(_) => env::panic_str(E_BAD_DOC_HASH),
    }
}

/// Decode a 64-byte ed25519 signature arriving as base64.
pub fn to_sig64(bytes: &Base64VecU8) -> [u8; 64] {
    match <[u8; 64]>::try_from(bytes.0.as_slice()) {
        Ok(s) => s,
        Err(_) => env::panic_str(E_BAD_SIG_LENGTH),
    }
}

/// The raw 32 bytes of an ed25519 [`PublicKey`].
///
/// `PublicKey::as_bytes()` returns 33 bytes for ed25519: a leading curve-type byte then
/// the key. `env::ed25519_verify` wants exactly the trailing 32, so this strips the
/// prefix and rejects any other curve.
pub fn ed25519_key_bytes(pk: &PublicKey) -> [u8; 32] {
    let bytes = pk.as_bytes();
    if bytes.len() != 33 || bytes[0] != 0 {
        env::panic_str(E_BAD_INVITE_KEY);
    }
    match <[u8; 32]>::try_from(&bytes[1..]) {
        Ok(k) => k,
        Err(_) => env::panic_str(E_BAD_INVITE_KEY),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_utils::*;
    use near_sdk::serde_json;

    /// This is the exact shape 1Click puts in `customRecipientMsg`, so a drift here
    /// breaks cross-chain payments silently.
    #[test]
    fn pay_msg_parses_from_the_wire_format() {
        let msg: TransferMsg =
            serde_json::from_str(r#"{"action":"pay","invoice_id":"42"}"#).unwrap();
        match msg {
            TransferMsg::Pay { invoice_id } => assert_eq!(invoice_id.0, 42),
            _ => panic!("expected Pay"),
        }
    }

    #[test]
    fn buy_msg_parses() {
        let msg: TransferMsg =
            serde_json::from_str(r#"{"action":"buy","invoice_id":"7"}"#).unwrap();
        assert!(matches!(msg, TransferMsg::Buy { .. }));
    }

    #[test]
    fn invoice_id_must_be_a_json_string_not_a_number() {
        // U64 serialises as a string, which keeps ids safe for JS clients. A bare number
        // is rejected rather than silently truncated.
        assert!(
            serde_json::from_str::<TransferMsg>(r#"{"action":"pay","invoice_id":42}"#).is_err()
        );
    }

    #[test]
    fn unknown_action_and_malformed_json_are_rejected() {
        assert!(
            serde_json::from_str::<TransferMsg>(r#"{"action":"steal","invoice_id":"1"}"#).is_err()
        );
        assert!(serde_json::from_str::<TransferMsg>("not json").is_err());
        assert!(serde_json::from_str::<TransferMsg>(r#"{"invoice_id":"1"}"#).is_err());
    }

    /// `PublicKey::as_bytes()` returns 33 bytes for ed25519, with a leading curve byte.
    /// `ed25519_verify` needs the trailing 32. If this ever regresses, every invite
    /// signature silently fails to verify.
    #[test]
    fn ed25519_key_bytes_strips_the_curve_prefix() {
        let signing = invite_signing_key();
        let near_pk = near_public_key(&signing);

        assert_eq!(near_pk.as_bytes().len(), 33);
        assert_eq!(near_pk.as_bytes()[0], 0, "0 is the ed25519 curve type");

        let stripped = ed25519_key_bytes(&near_pk);
        assert_eq!(stripped.len(), 32);
        assert_eq!(&stripped, signing.verifying_key().as_bytes());
    }

    #[test]
    fn byte_decoders_accept_correct_lengths() {
        assert_eq!(to_hash32(&Base64VecU8::from(vec![1u8; 32])), [1u8; 32]);
        assert_eq!(to_sig64(&Base64VecU8::from(vec![2u8; 64])), [2u8; 64]);
    }

    #[test]
    #[should_panic(expected = "E_BAD_DOC_HASH")]
    fn short_hash_is_rejected() {
        to_hash32(&Base64VecU8::from(vec![1u8; 31]));
    }

    #[test]
    #[should_panic(expected = "E_BAD_SIG_LENGTH")]
    fn wrong_length_signature_is_rejected() {
        to_sig64(&Base64VecU8::from(vec![2u8; 63]));
    }

    #[test]
    fn overdue_is_derived_only_for_agreed_invoices() {
        let mut invoice = Invoice {
            issuer: acc(ISSUER),
            client: None,
            invite_pk: invite_public_key(),
            token: acc(USDC),
            amount: 1_000_000,
            paid: 0,
            due_date: NOW,
            doc_hash: [0u8; 32],
            status: Status::Issued,
            created_at: NOW,
            accepted_at: None,
            paid_at: None,
            reject_reason_hash: None,
            storage_deposit: 0,
            listing: None,
        };
        let past_due = NOW + DAY;

        // Not yet agreed, so not overdue.
        assert_eq!(invoice.status_view(past_due), StatusView::Issued);

        invoice.status = Status::Accepted;
        assert_eq!(invoice.status_view(past_due), StatusView::Overdue);
        assert_eq!(invoice.status_view(NOW), StatusView::Accepted);

        invoice.status = Status::PartiallyPaid;
        assert_eq!(invoice.status_view(past_due), StatusView::Overdue);

        // Settled invoices never read as overdue, however late they were.
        invoice.status = Status::Paid;
        assert_eq!(invoice.status_view(past_due), StatusView::Paid);

        invoice.status = Status::Cancelled;
        assert_eq!(invoice.status_view(past_due), StatusView::Cancelled);
        invoice.status = Status::Rejected;
        assert_eq!(invoice.status_view(past_due), StatusView::Rejected);
    }

    #[test]
    fn unpaid_and_payable_track_the_amounts() {
        let mut invoice = Invoice {
            issuer: acc(ISSUER),
            client: None,
            invite_pk: invite_public_key(),
            token: acc(USDC),
            amount: 1_000_000,
            paid: 250_000,
            due_date: NOW + DAY,
            doc_hash: [0u8; 32],
            status: Status::PartiallyPaid,
            created_at: NOW,
            accepted_at: None,
            paid_at: None,
            reject_reason_hash: None,
            storage_deposit: 0,
            listing: None,
        };
        assert_eq!(invoice.unpaid(), 750_000);
        assert!(!invoice.is_fully_paid());
        assert!(invoice.is_payable());

        invoice.paid = 1_000_000;
        assert_eq!(invoice.unpaid(), 0);
        assert!(invoice.is_fully_paid());

        for status in [Status::Rejected, Status::Cancelled, Status::Paid] {
            invoice.status = status;
            assert!(!invoice.is_payable(), "{status:?} must not accept payment");
        }
        for status in [Status::Issued, Status::Accepted, Status::PartiallyPaid] {
            invoice.status = status;
            assert!(invoice.is_payable(), "{status:?} must accept payment");
        }
    }
}

#[cfg(test)]
mod wire_format {
    use super::*;
    use near_sdk::serde_json;

    /// Pins the real JSON encoding of `Base64VecU8`.
    ///
    /// Worth asserting because near-sdk's `JsonSchema` for this type is inaccurate: the
    /// generated ABI describes it as an array of `uint8`, while serde actually emits a
    /// base64 **string**. Anything generating app types from the ABI must follow this
    /// test, not the schema, or `doc_hash` ends up typed as `number[]`.
    #[test]
    fn base64_bytes_encode_as_a_json_string() {
        let json = serde_json::to_string(&Base64VecU8::from(vec![0xDE, 0xAD, 0xBE, 0xEF])).unwrap();
        assert_eq!(json, "\"3q2+7w==\"");

        let decoded: Base64VecU8 = serde_json::from_str("\"3q2+7w==\"").unwrap();
        assert_eq!(decoded.0, vec![0xDE, 0xAD, 0xBE, 0xEF]);
    }

    /// A 32-byte hash is 44 base64 characters, which is what the browser must send.
    #[test]
    fn a_32_byte_hash_round_trips() {
        let hash = [7u8; 32];
        let json = serde_json::to_string(&Base64VecU8::from(hash.to_vec())).unwrap();
        assert_eq!(json.len(), 46, "44 base64 chars plus two quotes");

        let decoded: Base64VecU8 = serde_json::from_str(&json).unwrap();
        assert_eq!(to_hash32(&decoded), hash);
    }

    /// Money crosses the ABI as a string so no client can round-trip it through a float.
    #[test]
    fn money_encodes_as_a_json_string() {
        let max = serde_json::to_string(&U128(u128::MAX)).unwrap();
        assert_eq!(max, "\"340282366920938463463374607431768211455\"");
        // 1,200.00 USDC at 6 decimals.
        assert_eq!(
            serde_json::to_string(&U128(1_200_000_000)).unwrap(),
            "\"1200000000\""
        );
    }
}
