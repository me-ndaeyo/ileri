#!/usr/bin/env bash
#
# Walk the whole product on testnet: issue, accept, pay, sell, and confirm a later
# payment reaches the buyer rather than the issuer.
#
# This is the same journey the sandbox suite runs, against the real deployed contract.
# It exists for two reasons. It proves the deploy is actually working before anyone
# spends real money on the 1Click test, and it is the script form of the README's
# "Try it" steps.
#
# Every step asserts. A green run means the contract behaved; it does not rely on reading
# the output by eye.
#
# Usage:
#   scripts/walkthrough-testnet.sh
#   CONTRACT=ileri.testnet TOKEN=usdc.ileri.testnet scripts/walkthrough-testnet.sh
set -euo pipefail

CONTRACT="${CONTRACT:-ileri.testnet}"
TOKEN="${TOKEN:-usdc.ileri.testnet}"
NETWORK="${NETWORK:-testnet}"

ISSUER="${ISSUER:-ileri-issuer.testnet}"
CLIENT="${CLIENT:-ileri-client.testnet}"
BUYER="${BUYER:-ileri-buyer.testnet}"

# 1,200 USDC invoice, 200 paid up front, sold for 900, remaining 1,000 to the buyer.
AMOUNT=1200000000
PART=200000000
PRICE=900000000
REST=1000000000
FUND=5000000000 # 5,000 USDC each, enough to pay and to buy

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="${NODE_BIN:-node}"
FAILED=0

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32mok\033[0m   %s\n' "$1"; }
bad()  { printf '    \033[31mFAIL\033[0m %s\n' "$1"; FAILED=1; }

expect() { # label actual expected
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — got $2, wanted $3"; fi
}

view() {
  near contract call-function as-read-only "$1" "$2" json-args "$3" \
    network-config "$NETWORK" now 2>/dev/null | tr -d '\n ' || true
}

# A change call. Quiet unless it fails, since the chatter buries the assertions.
#
# Deliberately not retried. The public testnet RPC drops requests intermittently, but a
# retry here could double-apply a step whose first attempt actually landed, and an invoice
# paid twice is a far worse outcome than a failed run. Setup uses `call_idempotent`
# instead; a failure in the journey itself is information and should stop the script.
call() { # contract method args gas deposit signer
  if ! near contract call-function as-transaction "$1" "$2" json-args "$3" \
      prepaid-gas "$4" attached-deposit "$5" sign-as "$6" \
      network-config "$NETWORK" sign-with-legacy-keychain send >/tmp/ileri-call.log 2>&1; then
    bad "$2 failed"
    tail -20 /tmp/ileri-call.log
    exit 1
  fi
}

# As `call`, but retried, for setup steps where doing the work twice is harmless.
#
# Only safe for `storage_deposit`, which refunds when the account is already registered,
# and `mint`, where a test account holding extra play money changes nothing. Never use it
# for anything in the journey.
call_idempotent() { # contract method args gas deposit signer
  local attempt
  for attempt in 1 2 3; do
    if near contract call-function as-transaction "$1" "$2" json-args "$3" \
        prepaid-gas "$4" attached-deposit "$5" sign-as "$6" \
        network-config "$NETWORK" sign-with-legacy-keychain send >/tmp/ileri-call.log 2>&1; then
      return 0
    fi
    [ "$attempt" -lt 3 ] && sleep $(( attempt * 2 ))
  done
  bad "$2 failed after 3 attempts"
  tail -20 /tmp/ileri-call.log
  exit 1
}

# `create_invoice` returns the new id on stdout; everything else goes to stderr.
call_capture() { # contract method args gas deposit signer
  near contract call-function as-transaction "$1" "$2" json-args "$3" \
    prepaid-gas "$4" attached-deposit "$5" sign-as "$6" \
    network-config "$NETWORK" sign-with-legacy-keychain send 2>/dev/null | tr -d '\n "'
}

account_exists() {
  near account view-account-summary "$1" network-config "$NETWORK" now >/dev/null 2>&1
}

json_field() { # json field
  printf '%s' "$1" | sed "s/.*\"$2\":\"\{0,1\}\([^,\"}]*\)\"\{0,1\}.*/\1/"
}

# --- cast -----------------------------------------------------------------------------

step "Setting up the cast"
for who in "$ISSUER" "$CLIENT" "$BUYER"; do
  if account_exists "$who"; then
    ok "$who exists"
  else
    near account create-account sponsor-by-faucet-service "$who" \
      autogenerate-new-keypair save-to-legacy-keychain \
      network-config "$NETWORK" create >/dev/null 2>&1
    ok "$who created by the faucet"
  fi
done

step "Funding the cast with test USDC"
for who in "$ISSUER" "$CLIENT" "$BUYER"; do
  call_idempotent "$TOKEN" storage_deposit "{\"account_id\":\"$who\",\"registration_only\":true}" \
    '30 Tgas' '0.0125 NEAR' "$TOKEN"
  call_idempotent "$TOKEN" mint "{\"account_id\":\"$who\",\"amount\":\"$FUND\"}" \
    '30 Tgas' '0 NEAR' "$TOKEN"
done
ok "each holds $(( FUND / 1000000 )) USDC"

# --- issue ----------------------------------------------------------------------------

step "The issuer creates an invoice"
INVITE=$("$NODE_BIN" "$ROOT/scripts/invite-key.mjs" generate)
INVITE_PK=$(json_field "$INVITE" invite_pk)
INVITE_SK=$(json_field "$INVITE" secret_key_b64)
ok "invite key generated: ${INVITE_PK:0:24}..."

DUE=$(( ($(date +%s) + 30 * 86400) * 1000000000 ))
# sha256 of the offchain invoice file. Any 32 bytes will do here; the app computes the
# real hash in the browser.
DOC_HASH="AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM="

ID=$(call_capture "$CONTRACT" create_invoice \
  "{\"invite_pk\":\"$INVITE_PK\",\"token\":\"$TOKEN\",\"amount\":\"$AMOUNT\",\"due_date\":\"$DUE\",\"doc_hash\":\"$DOC_HASH\"}" \
  '100 Tgas' '0.05 NEAR' "$ISSUER")
[ -n "$ID" ] || { bad "create_invoice returned no id"; exit 1; }
ok "invoice $ID minted"

INV=$(view "$CONTRACT" get_invoice "{\"id\":\"$ID\"}")
expect "status is Issued"        "$(json_field "$INV" status)" "Issued"
expect "the issuer holds it"     "$(json_field "$INV" holder)" "$ISSUER"
expect "no client bound yet"     "$(printf '%s' "$INV" | grep -c '"client":null')" "1"

# --- accept ---------------------------------------------------------------------------

step "The client accepts, using the invite link"
# The contract publishes the exact message to sign, so the client never reconstructs it.
MESSAGE=$(view "$CONTRACT" invite_message \
  "{\"id\":\"$ID\",\"account\":\"$CLIENT\",\"action\":\"accept\"}" | tr -d '"')
expect "message binds contract, invoice, caller and action" \
  "$MESSAGE" "ileri:v1:$CONTRACT:$ID:$CLIENT:accept"

SIG=$("$NODE_BIN" "$ROOT/scripts/invite-key.mjs" sign "$INVITE_SK" "$MESSAGE")
call "$CONTRACT" accept_invoice "{\"id\":\"$ID\",\"invite_sig\":\"$SIG\"}" \
  '100 Tgas' '0 NEAR' "$CLIENT"

INV=$(view "$CONTRACT" get_invoice "{\"id\":\"$ID\"}")
expect "status is Accepted"  "$(json_field "$INV" status)" "Accepted"
expect "client is bound"     "$(json_field "$INV" client)" "$CLIENT"

# --- pay ------------------------------------------------------------------------------

step "The client pays part of it"
ISSUER_BEFORE=$(view "$TOKEN" ft_balance_of "{\"account_id\":\"$ISSUER\"}" | tr -d '"')
call "$TOKEN" ft_transfer_call \
  "{\"receiver_id\":\"$CONTRACT\",\"amount\":\"$PART\",\"msg\":\"{\\\"action\\\":\\\"pay\\\",\\\"invoice_id\\\":\\\"$ID\\\"}\"}" \
  '300 Tgas' '1 yoctoNEAR' "$CLIENT"

INV=$(view "$CONTRACT" get_invoice "{\"id\":\"$ID\"}")
expect "paid recorded"       "$(json_field "$INV" paid)" "$PART"
expect "status PartiallyPaid" "$(json_field "$INV" status)" "PartiallyPaid"
ISSUER_AFTER=$(view "$TOKEN" ft_balance_of "{\"account_id\":\"$ISSUER\"}" | tr -d '"')
expect "the money reached the holder" "$(( ISSUER_AFTER - ISSUER_BEFORE ))" "$PART"

# --- sell -----------------------------------------------------------------------------

step "The issuer sells the invoice at a discount"
call "$CONTRACT" list_invoice "{\"id\":\"$ID\",\"price\":\"$PRICE\"}" \
  '100 Tgas' '0 NEAR' "$ISSUER"

LISTING=$(view "$CONTRACT" get_listing "{\"id\":\"$ID\"}")
expect "listed at the asking price" "$(json_field "$LISTING" price)" "$PRICE"
expect "buyer sees what is still owed" "$(json_field "$LISTING" unpaid)" "$REST"

ISSUER_BEFORE=$(view "$TOKEN" ft_balance_of "{\"account_id\":\"$ISSUER\"}" | tr -d '"')
call "$TOKEN" ft_transfer_call \
  "{\"receiver_id\":\"$CONTRACT\",\"amount\":\"$PRICE\",\"msg\":\"{\\\"action\\\":\\\"buy\\\",\\\"invoice_id\\\":\\\"$ID\\\"}\"}" \
  '300 Tgas' '1 yoctoNEAR' "$BUYER"

INV=$(view "$CONTRACT" get_invoice "{\"id\":\"$ID\"}")
expect "the buyer now holds it" "$(json_field "$INV" holder)" "$BUYER"
expect "and it is off the market" "$(printf '%s' "$INV" | grep -c '"listing":null')" "1"
ISSUER_AFTER=$(view "$TOKEN" ft_balance_of "{\"account_id\":\"$ISSUER\"}" | tr -d '"')
expect "the seller was paid in the same step" "$(( ISSUER_AFTER - ISSUER_BEFORE ))" "$PRICE"

# --- the point ------------------------------------------------------------------------

step "The rest is paid, and it goes to the buyer"
BUYER_BEFORE=$(view "$TOKEN" ft_balance_of "{\"account_id\":\"$BUYER\"}" | tr -d '"')
ISSUER_BEFORE=$(view "$TOKEN" ft_balance_of "{\"account_id\":\"$ISSUER\"}" | tr -d '"')
# Reputation counters are cumulative and this script is re-runnable, so the only stable
# assertion is that this settlement added exactly one on-time payment.
ONTIME_BEFORE=$(json_field "$(view "$CONTRACT" get_reputation "{\"account_id\":\"$CLIENT\"}")" paid_on_time)
call "$TOKEN" ft_transfer_call \
  "{\"receiver_id\":\"$CONTRACT\",\"amount\":\"$REST\",\"msg\":\"{\\\"action\\\":\\\"pay\\\",\\\"invoice_id\\\":\\\"$ID\\\"}\"}" \
  '300 Tgas' '1 yoctoNEAR' "$CLIENT"

INV=$(view "$CONTRACT" get_invoice "{\"id\":\"$ID\"}")
expect "status is Paid"   "$(json_field "$INV" status)" "Paid"
expect "fully paid"       "$(json_field "$INV" paid)" "$AMOUNT"

BUYER_AFTER=$(view "$TOKEN" ft_balance_of "{\"account_id\":\"$BUYER\"}" | tr -d '"')
ISSUER_AFTER=$(view "$TOKEN" ft_balance_of "{\"account_id\":\"$ISSUER\"}" | tr -d '"')
expect "the buyer collected the remainder" "$(( BUYER_AFTER - BUYER_BEFORE ))" "$REST"
expect "the issuer got nothing further"    "$(( ISSUER_AFTER - ISSUER_BEFORE ))" "0"

step "Reputation"
REP=$(view "$CONTRACT" get_reputation "{\"account_id\":\"$CLIENT\"}")
expect "client credited with one more on-time payment" \
  "$(json_field "$REP" paid_on_time)" "$(( ONTIME_BEFORE + 1 ))"
expect "and nothing recorded as late" "$(json_field "$REP" paid_late)" "0"

# --- result ---------------------------------------------------------------------------

if [ "$FAILED" -eq 0 ]; then
  printf '\n\033[32mThe whole journey works on %s. Invoice %s.\033[0m\n' "$NETWORK" "$ID"
  printf 'https://%s.nearblocks.io/address/%s\n' "$NETWORK" "$CONTRACT"
else
  printf '\n\033[31mSomething above failed. Invoice %s.\033[0m\n' "$ID"
  exit 1
fi
