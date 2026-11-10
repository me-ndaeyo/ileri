//! End-to-end tests against a real NEAR node.
//!
//! The unit tests cover the logic exhaustively, but they run in a mocked VM: they can
//! assert that an `ft_transfer` receipt *looks* right without proving a token contract
//! would accept it. These tests exist for the things only a real runtime can show:
//!
//! - the genuine `ft_transfer_call` → `ft_on_transfer` round trip, including that the
//!   promise return value really does refund an overpayment
//! - `#[private]` rejecting an outside caller, which lives in the generated wrapper and
//!   is therefore unreachable from a direct Rust call
//! - a payout to an unregistered holder actually failing, so the `claimable` fallback is
//!   exercised rather than assumed
//! - the whole product in one pass: issue, accept, pay, sell, and a later payment
//!   reaching the buyer instead of the issuer
//!
//! Deliberately chosen over `near-workspaces`, which both design docs name: `cargo near
//! new` now scaffolds `near-sandbox` + `near-api`, so this follows the maintained path.

use near_api::{AccountId, Contract as ApiContract, NetworkConfig, Signer};
use near_sdk::serde_json::json;
use testresult::TestResult;

/// What a sent transaction resolves to. Carries `assert_success`, `assert_failure`
/// and `logs`, which is everything these tests need.
type TxResult = near_api::types::transaction::result::TransactionResult;

/// Six decimals, as USDC has, so amounts read the same as in production.
const USDC_DECIMALS: u32 = 6;
const DAY_NS: u64 = 86_400 * 1_000_000_000;

fn usdc(whole: u128) -> u128 {
    whole * 10u128.pow(USDC_DECIMALS)
}

// --- fixtures -------------------------------------------------------------------------

/// The invite keypair, from a fixed seed so a failure always reproduces.
fn invite_signing_key() -> ed25519_dalek::SigningKey {
    ed25519_dalek::SigningKey::from_bytes(&[7u8; 32])
}

/// The invite public key as NEAR writes it, `ed25519:<base58>`.
///
/// Derived through `near_sdk::PublicKey`'s own serialization rather than hand-rolled, so
/// the curve-prefix handling matches what the contract will verify.
fn invite_pk() -> String {
    let mut bytes = vec![0u8];
    bytes.extend_from_slice(invite_signing_key().verifying_key().as_bytes());
    let key = near_sdk::PublicKey::try_from(bytes).expect("a valid ed25519 key");
    json_string(&key)
}

fn doc_hash_b64() -> String {
    json_string(&near_sdk::json_types::Base64VecU8::from(vec![3u8; 32]))
}

fn sign_invite(message: &str) -> String {
    use ed25519_dalek::Signer;
    let signature = invite_signing_key()
        .sign(message.as_bytes())
        .to_bytes()
        .to_vec();
    json_string(&near_sdk::json_types::Base64VecU8::from(signature))
}

/// Serialize a value and unwrap the JSON string, so encodings always match the contract's.
fn json_string<T: near_sdk::serde::Serialize>(value: &T) -> String {
    near_sdk::serde_json::to_value(value)
        .expect("serializable")
        .as_str()
        .expect("a JSON string")
        .to_string()
}

/// Wall clock in nanoseconds. The sandbox runs on real time, so a due date 30 days out is
/// comfortably in the future from the node's point of view.
fn now_ns() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("after the epoch")
        .as_nanos() as u64
}

/// Everything a test needs: a running node, both contracts, and funded accounts.
struct Harness {
    /// Held, never read: dropping it shuts the node down, so it must outlive the test.
    _sandbox: near_sandbox::Sandbox,
    network: NetworkConfig,
    signer: std::sync::Arc<Signer>,
    ileri: AccountId,
    token: AccountId,
    issuer: AccountId,
    client: AccountId,
    buyer: AccountId,
}

impl Harness {
    async fn start() -> TestResult<Self> {
        let sandbox = near_sandbox::Sandbox::start_sandbox().await?;
        let network = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
        let signer = Signer::from_secret_key(
            near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?,
        )?;

        let ileri = make_account(&sandbox, "ileri.sandbox").await?;
        let token = make_account(&sandbox, "usdc.sandbox").await?;
        let issuer = make_account(&sandbox, "issuer.sandbox").await?;
        let client = make_account(&sandbox, "client.sandbox").await?;
        let buyer = make_account(&sandbox, "buyer.sandbox").await?;

        // The token first: Ileri's init takes its account id on the allowlist.
        ApiContract::deploy(token.clone())
            .use_code(token_wasm())
            .with_init_call("new_usdc", json!({}))?
            .with_signer(signer.clone())
            .send_to(&network)
            .await?
            .assert_success();

        ApiContract::deploy(ileri.clone())
            .use_code(ileri_wasm())
            .with_init_call(
                "init",
                json!({ "owner_id": ileri, "allowed_tokens": [token], "metadata": null }),
            )?
            .with_signer(signer.clone())
            .send_to(&network)
            .await?
            .assert_success();

        let harness = Self {
            _sandbox: sandbox,
            network,
            signer,
            ileri,
            token,
            issuer,
            client,
            buyer,
        };

        // The contract must be able to receive tokens at all. Payments are sent *to* it
        // before it forwards them, so an unregistered contract account makes every
        // payment fail inside the token.
        let ileri = harness.ileri.clone();
        let token = harness.token.clone();
        harness.register(&ileri, &token).await?;

        Ok(harness)
    }

    /// Give an account a NEP-145 storage deposit on the token.
    ///
    /// Without this a transfer *to* the account traps inside the token contract, which is
    /// why the design doc makes registering the contract account day-1 check number one.
    /// `payer` funds it, so an account can be registered before it holds anything.
    async fn register(&self, who: &AccountId, payer: &AccountId) -> TestResult<()> {
        ApiContract(self.token.clone())
            .call_function(
                "storage_deposit",
                json!({ "account_id": who, "registration_only": true }),
            )
            .transaction()
            .deposit(near_api::NearToken::from_millinear(10))
            .with_signer(payer.clone(), self.signer.clone())
            .send_to(&self.network)
            .await?
            .assert_success();
        Ok(())
    }

    /// Register an account on the token and give it a balance.
    async fn fund(&self, who: &AccountId, amount: u128) -> TestResult<()> {
        self.register(who, who).await?;

        ApiContract(self.token.clone())
            .call_function(
                "mint",
                json!({ "account_id": who, "amount": amount.to_string() }),
            )
            .transaction()
            .with_signer(self.token.clone(), self.signer.clone())
            .send_to(&self.network)
            .await?
            .assert_success();
        Ok(())
    }

    async fn ft_balance(&self, who: &AccountId) -> TestResult<u128> {
        let raw: String = ApiContract(self.token.clone())
            .call_function("ft_balance_of", json!({ "account_id": who }))
            .read_only()
            .fetch_from(&self.network)
            .await?
            .data;
        Ok(raw.parse()?)
    }

    /// Send tokens to the Ileri contract with a `msg`, which is how both paying and
    /// buying arrive.
    async fn transfer_call(
        &self,
        from: &AccountId,
        amount: u128,
        msg: &str,
    ) -> TestResult<TxResult> {
        Ok(ApiContract(self.token.clone())
            .call_function(
                "ft_transfer_call",
                json!({
                    "receiver_id": self.ileri,
                    "amount": amount.to_string(),
                    "msg": msg,
                }),
            )
            .transaction()
            .deposit(near_api::NearToken::from_yoctonear(1))
            .gas(near_api::NearGas::from_tgas(300))
            .with_signer(from.clone(), self.signer.clone())
            .send_to(&self.network)
            .await?)
    }

    /// Mint invoice 1 for `amount` and have the client accept it, so a test can get
    /// straight to the behaviour it cares about.
    async fn create_accepted_invoice(&self, amount: u128) -> TestResult<()> {
        ApiContract(self.ileri.clone())
            .call_function(
                "create_invoice",
                json!({
                    "invite_pk": invite_pk(),
                    "token": self.token,
                    "amount": amount.to_string(),
                    "due_date": (now_ns() + 30 * DAY_NS).to_string(),
                    "doc_hash": doc_hash_b64(),
                }),
            )
            .transaction()
            .deposit(near_api::NearToken::from_millinear(50))
            .gas(near_api::NearGas::from_tgas(100))
            .with_signer(self.issuer.clone(), self.signer.clone())
            .send_to(&self.network)
            .await?
            .assert_success();

        let message: String = ApiContract(self.ileri.clone())
            .call_function(
                "invite_message",
                json!({ "id": "1", "account": self.client, "action": "accept" }),
            )
            .read_only()
            .fetch_from(&self.network)
            .await?
            .data;

        ApiContract(self.ileri.clone())
            .call_function(
                "accept_invoice",
                json!({ "id": "1", "invite_sig": sign_invite(&message) }),
            )
            .transaction()
            .gas(near_api::NearGas::from_tgas(100))
            .with_signer(self.client.clone(), self.signer.clone())
            .send_to(&self.network)
            .await?
            .assert_success();
        Ok(())
    }

    async fn view_invoice(&self, id: u64) -> TestResult<near_sdk::serde_json::Value> {
        Ok(ApiContract(self.ileri.clone())
            .call_function("get_invoice", json!({ "id": id.to_string() }))
            .read_only()
            .fetch_from(&self.network)
            .await?
            .data)
    }
}

async fn make_account(sandbox: &near_sandbox::Sandbox, name: &str) -> TestResult<AccountId> {
    let id: AccountId = name.parse()?;
    sandbox
        .create_account(id.as_str().parse()?)
        .initial_balance(near_api::NearToken::from_near(50))
        .send()
        .await?;
    Ok(id)
}

/// Both wasms are built once and shared.
///
/// Tests run concurrently in one process, and `cargo near build` is not safe to run
/// several times at once against the same target directory: the builds race and one
/// fails. `OnceLock` guarantees a single build whatever the test order or thread count.
static ILERI_WASM: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
static TOKEN_WASM: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();

fn ileri_wasm() -> Vec<u8> {
    ILERI_WASM
        .get_or_init(|| {
            let path = cargo_near_build::build_with_cli(Default::default())
                .expect("building the ileri contract");
            std::fs::read(path).expect("reading the ileri wasm")
        })
        .clone()
}

fn token_wasm() -> Vec<u8> {
    TOKEN_WASM
        .get_or_init(|| {
            let path = build_test_token().expect("building the test token");
            std::fs::read(path).expect("reading the test token wasm")
        })
        .clone()
}

/// The test token is a plain cargo build: it needs no ABI or metadata, and building it
/// this way keeps the test independent of anything fetched at run time.
fn build_test_token() -> TestResult<std::path::PathBuf> {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("repo root")
        .join("test-token/Cargo.toml");

    let status = std::process::Command::new(env!("CARGO"))
        .args([
            "build",
            "--release",
            "--target",
            "wasm32-unknown-unknown",
            "--manifest-path",
        ])
        .arg(&manifest)
        .status()?;
    assert!(status.success(), "building the test token failed");

    Ok(manifest
        .parent()
        .unwrap()
        .join("target/wasm32-unknown-unknown/release/test_token.wasm"))
}

// =====================================================================================
// The full product in one pass
// =====================================================================================

/// Issue, accept, pay, sell, and confirm a later payment reaches the buyer.
///
/// This is the demo path, and the one claim that matters most: payments follow the
/// invoice, so selling it sells its future income.
#[tokio::test]
async fn the_whole_journey_works() -> TestResult<()> {
    let h = Harness::start().await?;
    h.fund(&h.client, usdc(5_000)).await?;
    h.fund(&h.buyer, usdc(5_000)).await?;

    // --- issue ---
    let due = now_ns() + 30 * DAY_NS;
    let id: String = ApiContract(h.ileri.clone())
        .call_function(
            "create_invoice",
            json!({
                "invite_pk": invite_pk(),
                "token": h.token,
                "amount": usdc(1_200).to_string(),
                "due_date": due.to_string(),
                "doc_hash": doc_hash_b64(),
            }),
        )
        .transaction()
        .deposit(near_api::NearToken::from_millinear(50))
        .gas(near_api::NearGas::from_tgas(100))
        .with_signer(h.issuer.clone(), h.signer.clone())
        .send_to(&h.network)
        .await?
        .assert_success()
        .json()?;
    assert_eq!(id, "1");

    let invoice = h.view_invoice(1).await?;
    assert_eq!(invoice["status"], "Issued");
    assert_eq!(invoice["holder"], h.issuer.as_str());

    // --- accept, with a signature over the message the contract publishes ---
    let message: String = ApiContract(h.ileri.clone())
        .call_function(
            "invite_message",
            json!({ "id": "1", "account": h.client, "action": "accept" }),
        )
        .read_only()
        .fetch_from(&h.network)
        .await?
        .data;
    assert_eq!(
        message,
        format!("ileri:v1:{}:1:{}:accept", h.ileri, h.client)
    );

    ApiContract(h.ileri.clone())
        .call_function(
            "accept_invoice",
            json!({ "id": "1", "invite_sig": sign_invite(&message) }),
        )
        .transaction()
        .gas(near_api::NearGas::from_tgas(100))
        .with_signer(h.client.clone(), h.signer.clone())
        .send_to(&h.network)
        .await?
        .assert_success();

    let invoice = h.view_invoice(1).await?;
    assert_eq!(invoice["status"], "Accepted");
    assert_eq!(invoice["client"], h.client.as_str());

    // --- a part payment, through a genuine ft_transfer_call ---
    let issuer_before = h.ft_balance(&h.issuer).await?;
    h.transfer_call(&h.client, usdc(200), r#"{"action":"pay","invoice_id":"1"}"#)
        .await?
        .assert_success();

    let invoice = h.view_invoice(1).await?;
    assert_eq!(invoice["paid"], usdc(200).to_string());
    assert_eq!(invoice["status"], "PartiallyPaid");
    assert_eq!(
        h.ft_balance(&h.issuer).await? - issuer_before,
        usdc(200),
        "the payment reached the holder, not just the contract"
    );

    // --- sell it at a discount to the unpaid balance ---
    ApiContract(h.ileri.clone())
        .call_function(
            "list_invoice",
            json!({ "id": "1", "price": usdc(900).to_string() }),
        )
        .transaction()
        .gas(near_api::NearGas::from_tgas(100))
        .with_signer(h.issuer.clone(), h.signer.clone())
        .send_to(&h.network)
        .await?
        .assert_success();

    let issuer_before = h.ft_balance(&h.issuer).await?;
    h.transfer_call(&h.buyer, usdc(900), r#"{"action":"buy","invoice_id":"1"}"#)
        .await?
        .assert_success();

    let invoice = h.view_invoice(1).await?;
    assert_eq!(
        invoice["holder"],
        h.buyer.as_str(),
        "the buyer now holds it"
    );
    assert!(invoice["listing"].is_null(), "and it is off the market");
    assert_eq!(
        h.ft_balance(&h.issuer).await? - issuer_before,
        usdc(900),
        "the seller was paid in the same step"
    );

    // --- the rest of the invoice is paid, and it goes to the buyer ---
    let buyer_before = h.ft_balance(&h.buyer).await?;
    let issuer_before = h.ft_balance(&h.issuer).await?;
    h.transfer_call(
        &h.client,
        usdc(1_000),
        r#"{"action":"pay","invoice_id":"1"}"#,
    )
    .await?
    .assert_success();

    let invoice = h.view_invoice(1).await?;
    assert_eq!(invoice["status"], "Paid");
    assert_eq!(invoice["paid"], usdc(1_200).to_string());
    assert_eq!(
        h.ft_balance(&h.buyer).await? - buyer_before,
        usdc(1_000),
        "the buyer collected the remaining balance"
    );
    assert_eq!(
        h.ft_balance(&h.issuer).await?,
        issuer_before,
        "and the issuer got nothing further, having sold it"
    );

    Ok(())
}

// =====================================================================================
// Things only a real runtime can prove
// =====================================================================================

/// An overpayment really is refunded, through the promise return value.
///
/// Unit tests can only assert that `on_payout` returns the excess. Whether NEP-141 then
/// hands it back to the sender is a property of the token contract, so it needs this.
#[tokio::test]
async fn an_overpayment_is_refunded_to_the_sender() -> TestResult<()> {
    let h = Harness::start().await?;
    h.fund(&h.client, usdc(5_000)).await?;
    h.create_accepted_invoice(usdc(100)).await?;

    let client_before = h.ft_balance(&h.client).await?;
    h.transfer_call(&h.client, usdc(150), r#"{"action":"pay","invoice_id":"1"}"#)
        .await?
        .assert_success();

    let invoice = h.view_invoice(1).await?;
    assert_eq!(invoice["paid"], usdc(100).to_string());
    assert_eq!(
        client_before - h.ft_balance(&h.client).await?,
        usdc(100),
        "only the amount owed left the payer; the extra 50 came back"
    );
    Ok(())
}

/// A payout to an unregistered holder fails, and the money becomes claimable.
///
/// This is the whole reason `claimable` exists, and it cannot be produced in a unit test
/// because it depends on the token contract genuinely rejecting the transfer.
#[tokio::test]
async fn a_payout_to_an_unregistered_holder_becomes_claimable() -> TestResult<()> {
    let h = Harness::start().await?;
    h.fund(&h.client, usdc(5_000)).await?;

    // The issuer is registered at mint, so unregister to force the failure.
    h.create_accepted_invoice(usdc(100)).await?;
    ApiContract(h.token.clone())
        .call_function("storage_unregister", json!({ "force": true }))
        .transaction()
        .deposit(near_api::NearToken::from_yoctonear(1))
        .with_signer(h.issuer.clone(), h.signer.clone())
        .send_to(&h.network)
        .await?
        .assert_success();

    h.transfer_call(&h.client, usdc(100), r#"{"action":"pay","invoice_id":"1"}"#)
        .await?
        .assert_success();

    // The invoice is still paid: the client did pay.
    let invoice = h.view_invoice(1).await?;
    assert_eq!(invoice["status"], "Paid");

    let claimable: String = ApiContract(h.ileri.clone())
        .call_function(
            "get_claimable",
            json!({ "account_id": h.issuer, "token": h.token }),
        )
        .read_only()
        .fetch_from(&h.network)
        .await?
        .data;
    assert_eq!(claimable, usdc(100).to_string(), "owed, not lost");

    // Register again and withdraw.
    h.fund(&h.issuer, 0).await?;
    ApiContract(h.ileri.clone())
        .call_function("withdraw_claimable", json!({ "token": h.token }))
        .transaction()
        .gas(near_api::NearGas::from_tgas(100))
        .with_signer(h.issuer.clone(), h.signer.clone())
        .send_to(&h.network)
        .await?
        .assert_success();

    assert_eq!(h.ft_balance(&h.issuer).await?, usdc(100));
    Ok(())
}

/// `#[private]` callbacks reject an outside caller.
///
/// The check lives in the generated extern wrapper, not the Rust method, so a direct
/// unit call cannot reach it. Only a real invocation can.
#[tokio::test]
async fn private_callbacks_reject_outside_callers() -> TestResult<()> {
    let h = Harness::start().await?;

    for method in ["on_payout", "on_withdraw_resolve", "nft_resolve_transfer"] {
        let outcome = ApiContract(h.ileri.clone())
            .call_function(
                method,
                json!({
                    "holder": h.issuer, "account": h.issuer, "token": h.token,
                    "applied": "1", "amount": "1", "excess": "0",
                    "previous_owner_id": h.issuer, "receiver_id": h.buyer, "token_id": "1",
                }),
            )
            .transaction()
            .gas(near_api::NearGas::from_tgas(50))
            .with_signer(h.buyer.clone(), h.signer.clone())
            .send_to(&h.network)
            .await?;

        assert!(
            outcome.into_result().is_err(),
            "{method} must refuse a caller that is not the contract itself"
        );
    }
    Ok(())
}

/// A spoofed `ft_on_transfer` changes nothing, against the real runtime.
#[tokio::test]
async fn a_spoofed_payment_is_refused_onchain() -> TestResult<()> {
    let h = Harness::start().await?;
    h.fund(&h.client, usdc(5_000)).await?;
    h.create_accepted_invoice(usdc(100)).await?;

    // Called directly, with no tokens behind it.
    ApiContract(h.ileri.clone())
        .call_function(
            "ft_on_transfer",
            json!({
                "sender_id": h.buyer,
                "amount": usdc(100).to_string(),
                "msg": r#"{"action":"pay","invoice_id":"1"}"#,
            }),
        )
        .transaction()
        .gas(near_api::NearGas::from_tgas(50))
        .with_signer(h.buyer.clone(), h.signer.clone())
        .send_to(&h.network)
        .await?
        .assert_success();

    let invoice = h.view_invoice(1).await?;
    assert_eq!(invoice["paid"], "0", "no money may be credited");
    assert_eq!(invoice["status"], "Accepted");
    Ok(())
}
