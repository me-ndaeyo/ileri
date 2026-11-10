//! Shared unit-test fixtures.
//!
//! Keys come from fixed seeds, never randomness, so a failing test always reproduces with
//! the same bytes.

use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{AccountId, NearToken, PublicKey, testing_env};

use crate::Contract;

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
