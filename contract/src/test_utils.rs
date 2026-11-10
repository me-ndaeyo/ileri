//! Shared unit-test fixtures.
//!
//! Keys come from fixed seeds, never randomness, so a failing test always reproduces with
//! the same bytes.

use ed25519_dalek::{Signer, SigningKey};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_sdk::PromiseOrValue;
use near_sdk::json_types::{Base64VecU8, U128};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, PublicKey, testing_env};

use crate::Contract;
use crate::types::Status;

pub const CONTRACT: &str = "ileri.near";
pub const OWNER: &str = "owner.near";
pub const ISSUER: &str = "issuer.near";
pub const CLIENT: &str = "client.near";
pub const STRANGER: &str = "stranger.near";
pub const USDC: &str = "usdc.near";
pub const OTHER_TOKEN: &str = "dai.near";

/// One day in nanoseconds.
pub const DAY: u64 = 86_400 * 1_000_000_000;
/// Default "now" used by [`context`]. Non-zero so "before now" is expressible.
pub const NOW: u64 = 1_000 * DAY;

pub fn acc(name: &str) -> AccountId {
    name.parse().unwrap()
}

/// The invite keypair. A second seed is available via [`other_signing_key`] for tests
/// that need a key the contract does *not* trust.
const INVITE_SEED: [u8; 32] = [7u8; 32];
const OTHER_SEED: [u8; 32] = [9u8; 32];

pub fn invite_signing_key() -> SigningKey {
    SigningKey::from_bytes(&INVITE_SEED)
}

pub fn other_signing_key() -> SigningKey {
    SigningKey::from_bytes(&OTHER_SEED)
}

/// Convert a dalek verifying key into a NEAR [`PublicKey`].
///
/// NEAR prefixes the 32 key bytes with a curve-type byte, `0` for ed25519. This is the
/// inverse of `types::ed25519_key_bytes`.
pub fn near_public_key(key: &SigningKey) -> PublicKey {
    let mut bytes = Vec::with_capacity(33);
    bytes.push(0u8);
    bytes.extend_from_slice(key.verifying_key().as_bytes());
    PublicKey::try_from(bytes).unwrap()
}

pub fn invite_public_key() -> PublicKey {
    near_public_key(&invite_signing_key())
}

/// Sign `message` and return the 64 raw signature bytes.
pub fn sign(key: &SigningKey, message: &str) -> Vec<u8> {
    key.sign(message.as_bytes()).to_bytes().to_vec()
}

/// A context with sensible defaults: `ileri.near` is the contract, `now` is [`NOW`], and
/// no deposit is attached.
pub fn context(predecessor: &str) -> VMContextBuilder {
    let mut builder = VMContextBuilder::new();
    builder
        .current_account_id(acc(CONTRACT))
        .signer_account_id(acc(predecessor))
        .predecessor_account_id(acc(predecessor))
        .block_timestamp(NOW)
        .attached_deposit(NearToken::from_yoctonear(0));
    builder
}

/// Install a context for `predecessor` with the defaults above.
pub fn set_context(predecessor: &str) {
    testing_env!(context(predecessor).build());
}

/// Install a context with an attached deposit, for `#[payable]` calls.
pub fn set_context_with_deposit(predecessor: &str, deposit: NearToken) {
    let mut builder = context(predecessor);
    builder.attached_deposit(deposit);
    testing_env!(builder.build());
}

/// A contract owned by [`OWNER`] with USDC allowlisted, plus a context ready for `who`.
pub fn setup(who: &str) -> Contract {
    testing_env!(context(OWNER).build());
    let contract = Contract::init(acc(OWNER), vec![acc(USDC)], None);
    set_context(who);
    contract
}

/// Enough NEAR to cover an invoice's storage plus one NEP-145 registration, with room to
/// spare so the refund path is exercised.
pub fn mint_deposit() -> NearToken {
    NearToken::from_millinear(50)
}

/// A due date comfortably in the future relative to [`NOW`].
pub fn future_due() -> u64 {
    NOW + 30 * DAY
}

/// Mint one invoice for `amount` as [`ISSUER`] and return (contract, id).
pub fn with_invoice(amount: u128) -> (Contract, u64) {
    let mut contract = setup(OWNER);
    set_context_with_deposit(ISSUER, mint_deposit());
    let id = contract.create_invoice(
        invite_public_key(),
        acc(USDC),
        amount.into(),
        future_due().into(),
        vec![3u8; 32].into(),
        None,
    );
    (contract, id.0)
}

/// A cross-contract function call that the call under test scheduled.
#[derive(Debug)]
pub struct CallReceipt {
    pub receiver: AccountId,
    pub method: String,
    pub args: String,
    pub deposit: NearToken,
}

/// Every cross-contract function call scheduled by the call under test.
///
/// `MockAction::FunctionCallWeight` carries `method_name` and `args` as raw bytes, so
/// matching on the Debug output silently never matches. This decodes them.
pub fn function_calls() -> Vec<CallReceipt> {
    let mut out = Vec::new();
    for receipt in near_sdk::test_utils::get_created_receipts() {
        for action in &receipt.actions {
            if let near_sdk::mock::MockAction::FunctionCallWeight {
                method_name,
                args,
                attached_deposit,
                ..
            } = action
            {
                out.push(CallReceipt {
                    receiver: receipt.receiver_id.clone(),
                    method: String::from_utf8_lossy(method_name).into_owned(),
                    args: String::from_utf8_lossy(args).into_owned(),
                    deposit: *attached_deposit,
                });
            }
        }
    }
    out
}

/// The one call to `method`, or `None`. Panics if there is more than one.
pub fn find_call(method: &str) -> Option<CallReceipt> {
    let mut matches: Vec<CallReceipt> = function_calls()
        .into_iter()
        .filter(|c| c.method == method)
        .collect();
    assert!(
        matches.len() <= 1,
        "expected at most one {method} call, got {}",
        matches.len()
    );
    matches.pop()
}

/// Every plain NEAR transfer scheduled by the call under test, as (receiver, yocto).
pub fn transfers() -> Vec<(AccountId, u128)> {
    let mut out = Vec::new();
    for receipt in near_sdk::test_utils::get_created_receipts() {
        for action in &receipt.actions {
            if let near_sdk::mock::MockAction::Transfer { deposit, .. } = action {
                out.push((receipt.receiver_id.clone(), deposit.as_yoctonear()));
            }
        }
    }
    out
}

/// Sign the message the contract itself publishes for (id, who, action).
///
/// Positive tests go through `invite_message` on purpose: if the view and the verifier
/// ever disagree, these tests fail instead of silently agreeing on a wrong format.
pub fn signed_for(contract: &Contract, id: u64, who: &str, action: &str) -> Base64VecU8 {
    let message = contract.invite_message(id.into(), acc(who), action.to_string());
    sign(&invite_signing_key(), &message).into()
}

/// Sign an arbitrary message with the trusted invite key, for tests that need a
/// well-formed signature over the *wrong* content.
pub fn signed_raw(message: &str) -> Base64VecU8 {
    sign(&invite_signing_key(), message).into()
}

/// Force an invoice into a terminal state directly.
///
/// Used by tests for behaviour that is downstream of states `ft_on_transfer` produces,
/// so they do not have to wait on the payment path being built.
pub fn force_status(contract: &mut Contract, id: u64, status: Status, paid: u128) {
    if let Some(invoice) = contract.invoices.get_mut(&id) {
        invoice.status = status;
        invoice.paid = paid;
    }
}

/// The amount `ft_on_transfer` reported as unused, or `None` when it returned a promise.
///
/// A promise means the payment was accepted and the unused amount comes from the final
/// callback's return value instead, per NEP-141.
pub fn unused(result: PromiseOrValue<U128>) -> Option<u128> {
    match result {
        PromiseOrValue::Value(value) => Some(value.0),
        PromiseOrValue::Promise(_) => None,
    }
}

/// Call `ft_on_transfer` as `token` would, with `payer` as the NEP-141 sender.
pub fn pay_as(
    contract: &mut Contract,
    token: &str,
    amount: u128,
    msg: &str,
) -> PromiseOrValue<U128> {
    set_context(token);
    contract.ft_on_transfer(acc(STRANGER), amount.into(), msg.to_string())
}

/// The standard `{"action":"pay","invoice_id":"<id>"}` message.
pub fn pay_msg(id: u64) -> String {
    format!(r#"{{"action":"pay","invoice_id":"{id}"}}"#)
}

/// Install a context whose single promise result is `result`, for testing callbacks.
///
/// Callbacks are `#[private]`, so the predecessor must be the contract itself.
pub fn set_callback_context(result: near_sdk::PromiseResult) {
    testing_env!(
        context(CONTRACT).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        std::collections::HashMap::default(),
        vec![result]
    );
}

/// Install a context at an explicit block timestamp, for testing derived Overdue.
pub fn set_context_at(predecessor: &str, timestamp: u64) {
    let mut builder = context(predecessor);
    builder.block_timestamp(timestamp);
    testing_env!(builder.build());
}
