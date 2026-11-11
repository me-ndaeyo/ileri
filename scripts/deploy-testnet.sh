#!/usr/bin/env bash
#
# Deploy Ileri and a test token to NEAR testnet.
#
# Idempotent: safe to re-run. Redeploys code, skips account creation and initialization
# that has already happened, and re-registers nothing that is already registered.
#
# The one step that is easy to forget and expensive to get wrong is registering the
# contract account on the payment token. Without it every payment traps inside the token,
# and the 1Click docs are explicit that funds are *lost* if the recipient lacks
# `ft_on_transfer` or a storage deposit. This script always checks it.
#
# Usage:
#   scripts/deploy-testnet.sh                      # defaults below
#   scripts/deploy-testnet.sh --mint-to you.testnet
#   CONTRACT=ileri2.testnet scripts/deploy-testnet.sh
set -euo pipefail

CONTRACT="${CONTRACT:-ileri.testnet}"
TOKEN="${TOKEN:-}"
NETWORK="${NETWORK:-testnet}"
MINT_TO=""
MINT_AMOUNT="${MINT_AMOUNT:-10000000000}" # 10,000 USDC at 6 decimals

while [ $# -gt 0 ]; do
  case "$1" in
    --contract) CONTRACT="$2"; shift 2 ;;
    --token)    TOKEN="$2";    shift 2 ;;
    --mint-to)  MINT_TO="$2";  shift 2 ;;
    --network)  NETWORK="$2";  shift 2 ;;
    -h|--help)  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# The token lives as a subaccount of the contract, so it is unambiguously part of this
# deployment and costs nothing beyond storage.
TOKEN="${TOKEN:-usdc.$CONTRACT}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
note() { printf '    %s\n' "$1"; }

# --- preflight ------------------------------------------------------------------------

command -v near >/dev/null 2>&1 || { echo "near CLI not found. Run: make setup" >&2; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "cargo not found. Run: make setup" >&2; exit 1; }

if [ "$NETWORK" = "mainnet" ]; then
  cat >&2 <<'WARN'
This script is for testnet only.
Mainnet deploys spend real funds and are not scripted on purpose: run the commands by
hand so each one is a deliberate decision.
WARN
  exit 1
fi

account_exists() {
  near account view-account-summary "$1" network-config "$NETWORK" now >/dev/null 2>&1
}

# A view call that only succeeds once the contract is initialized.
contract_initialized() {
  near contract call-function as-read-only "$1" get_owner_id json-args '{}' \
    network-config "$NETWORK" now >/dev/null 2>&1
}

say "Preflight"
if ! account_exists "$CONTRACT"; then
  cat >&2 <<EOF
$CONTRACT does not exist yet. Create it first:

  near account create-account sponsor-by-faucet-service $CONTRACT \\
    autogenerate-new-keypair save-to-legacy-keychain \\
    network-config $NETWORK create
EOF
  exit 1
fi
note "contract account: $CONTRACT"
note "token account:    $TOKEN"

# --- build ----------------------------------------------------------------------------

say "Building the contract"
( cd "$ROOT/contract" && cargo near build non-reproducible-wasm )
ILERI_WASM="$ROOT/contract/target/near/ileri.wasm"

# Built through cargo-near rather than plain cargo so wasm-opt runs: that halves the
# binary, 301KB to 154KB, and storage costs 1e19 yocto per byte, so it halves the NEAR
# the token account has to hold. The sandbox tests build this crate with plain cargo
# instead, where accounts are richly funded and build speed matters more than size.
say "Building the test token"
( cd "$ROOT/test-token" && cargo near build non-reproducible-wasm )
TOKEN_WASM="$ROOT/test-token/target/near/test_token.wasm"

# --- token ----------------------------------------------------------------------------

if ! account_exists "$TOKEN"; then
  say "Creating the token subaccount"
  # Covers the ~1.54 NEAR of storage the optimized token wasm needs, with headroom for
  # the per-account storage the token itself allocates as accounts register.
  near account create-account fund-myself "$TOKEN" '2.5 NEAR' \
    autogenerate-new-keypair save-to-legacy-keychain \
    sign-as "$CONTRACT" \
    network-config "$NETWORK" sign-with-legacy-keychain send
else
  note "token account already exists"
fi

say "Deploying the test token"
if contract_initialized "$TOKEN"; then
  note "already initialized, deploying code only"
  near contract deploy "$TOKEN" use-file "$TOKEN_WASM" without-init-call \
    network-config "$NETWORK" sign-with-legacy-keychain send
else
  near contract deploy "$TOKEN" use-file "$TOKEN_WASM" \
    with-init-call new_usdc json-args '{}' \
    prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
    network-config "$NETWORK" sign-with-legacy-keychain send
fi

# --- contract -------------------------------------------------------------------------

say "Deploying Ileri"
if contract_initialized "$CONTRACT"; then
  note "already initialized, deploying code only"
  note "state is preserved, so existing invoices survive the upgrade"
  near contract deploy "$CONTRACT" use-file "$ILERI_WASM" without-init-call \
    network-config "$NETWORK" sign-with-legacy-keychain send
else
  near contract deploy "$CONTRACT" use-file "$ILERI_WASM" \
    with-init-call init \
    json-args "{\"owner_id\":\"$CONTRACT\",\"allowed_tokens\":[\"$TOKEN\"],\"metadata\":null}" \
    prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
    network-config "$NETWORK" sign-with-legacy-keychain send
fi

# --- the precondition that matters ----------------------------------------------------

say "Registering the contract on the token"
note "without this every payment traps inside the token contract"
near contract call-function as-transaction "$TOKEN" storage_deposit \
  json-args "{\"account_id\":\"$CONTRACT\",\"registration_only\":true}" \
  prepaid-gas '30 Tgas' attached-deposit '0.0125 NEAR' \
  sign-as "$CONTRACT" \
  network-config "$NETWORK" sign-with-legacy-keychain send

# --- optional test funds --------------------------------------------------------------

if [ -n "$MINT_TO" ]; then
  say "Funding $MINT_TO with test USDC"
  near contract call-function as-transaction "$TOKEN" storage_deposit \
    json-args "{\"account_id\":\"$MINT_TO\",\"registration_only\":true}" \
    prepaid-gas '30 Tgas' attached-deposit '0.0125 NEAR' \
    sign-as "$CONTRACT" \
    network-config "$NETWORK" sign-with-legacy-keychain send

  near contract call-function as-transaction "$TOKEN" mint \
    json-args "{\"account_id\":\"$MINT_TO\",\"amount\":\"$MINT_AMOUNT\"}" \
    prepaid-gas '30 Tgas' attached-deposit '0 NEAR' \
    sign-as "$TOKEN" \
    network-config "$NETWORK" sign-with-legacy-keychain send
fi

# --- report ---------------------------------------------------------------------------

say "Deployed"
cat <<EOF
Put these in app/.env.local (gitignored):

  NEXT_PUBLIC_NETWORK=$NETWORK
  NEXT_PUBLIC_CONTRACT_ID=$CONTRACT
  NEXT_PUBLIC_TOKEN_ID=$TOKEN

Check it answers:

  near contract call-function as-read-only $CONTRACT get_allowed_tokens json-args '{}' \\
    network-config $NETWORK now

Explorer:

  https://testnet.nearblocks.io/address/$CONTRACT
EOF
