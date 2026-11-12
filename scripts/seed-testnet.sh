#!/usr/bin/env bash
#
# Put a few invoices on testnet so the dashboard and the market have something in them.
#
# Not a test. The walkthrough asserts; this only creates, so the screens are worth looking
# at and the demo has a market with more than one row. It makes one invoice in each state
# that matters, because a list where everything says "Issued" shows none of the design:
#
#   1. awaiting the client          Issued, nothing paid
#   2. accepted                     Accepted, nothing paid
#   3. part paid                    PartiallyPaid, a quarter in
#   4. listed for sale              Accepted and on the market, below the unpaid balance
#   5. settled                      Paid in full
#
# Usage:
#   scripts/seed-testnet.sh                        # as ileri-issuer.testnet
#   ISSUER=test-issuer.testnet CLIENT=test-company.testnet scripts/seed-testnet.sh
#
# The issuer and client need their keys in the legacy keychain, and the easiest direction
# is usually the opposite one: `ileri-issuer.testnet` already has its key here, so import
# THAT into your wallet and sign in as it. The seed phrase is in
# ~/.near-credentials/testnet/ileri-issuer.testnet.json and Meteor takes a seed phrase.
#
# To seed a wallet account instead, export its private key from the wallet and:
#   near account import-account using-private-key network-config testnet
#
# NOT `using-web-wallet`: that path is hardcoded to MyNearWallet and cannot see a Meteor
# or HOT account, so it fails with UnknownAccessKey however correct everything else is.
#
# Re-running adds another five. There is no way to delete an invoice, only to close a
# final one, so run it once and check the dashboard before running it again.
set -euo pipefail

CONTRACT="${CONTRACT:-ileri.testnet}"
TOKEN="${TOKEN:-usdc.ileri.testnet}"
NETWORK="${NETWORK:-testnet}"

ISSUER="${ISSUER:-ileri-issuer.testnet}"
CLIENT="${CLIENT:-ileri-client.testnet}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="${NODE_BIN:-node}"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32mok\033[0m   %s\n' "$1"; }
die()  { printf '    \033[31mFAIL\033[0m %s\n' "$1"; exit 1; }

view() {
  near contract call-function as-read-only "$1" "$2" json-args "$3" \
    network-config "$NETWORK" now 2>/dev/null | tr -d '\n ' || true
}

json_field() { # json field
  printf '%s' "$1" | sed "s/.*\"$2\":\"\{0,1\}\([^,\"}]*\)\"\{0,1\}.*/\1/"
}

call() { # contract method args gas deposit signer
  if ! near contract call-function as-transaction "$1" "$2" json-args "$3" \
      prepaid-gas "$4" attached-deposit "$5" sign-as "$6" \
      network-config "$NETWORK" sign-with-legacy-keychain send >/tmp/ileri-seed.log 2>&1; then
    tail -20 /tmp/ileri-seed.log
    die "$2 as $6 failed"
  fi
}

# `create_invoice` returns the new id, which is the only place it appears. Same shape as
# the walkthrough's, deliberately: the output format is near-cli's and not ours to guess.
call_capture() { # contract method args gas deposit signer
  near contract call-function as-transaction "$1" "$2" json-args "$3" \
    prepaid-gas "$4" attached-deposit "$5" sign-as "$6" \
    network-config "$NETWORK" sign-with-legacy-keychain send 2>/dev/null | tr -d '\n "'
}

# A whole number of USDC, which has 6 decimals.
usdc() { printf '%s000000' "$1"; }

DOC_HASH="AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM="

# --- make one invoice, and return its id and invite secret ---------------------------
#
# The invite key is generated per invoice, exactly as the browser does, because accepting
# requires a signature from it and there is no way to accept without one.
# Sets ID and SK rather than echoing them. `die` inside a command substitution only kills
# the subshell and its message is captured as the value, which is how a failed create
# became an invoice whose id was the word FAIL.
make_invoice() { # amount days_until_due
  local amount="$1" days="$2" invite invite_pk due
  invite=$("$NODE_BIN" "$ROOT/scripts/invite-key.mjs" generate)
  invite_pk=$(json_field "$invite" invite_pk)
  SK=$(json_field "$invite" secret_key_b64)
  [ -n "$invite_pk" ] || die "could not generate an invite key"
  due=$(( ($(date +%s) + days * 86400) * 1000000000 ))

  ID=$(call_capture "$CONTRACT" create_invoice \
    "{\"invite_pk\":\"$invite_pk\",\"token\":\"$TOKEN\",\"amount\":\"$amount\",\"due_date\":\"$due\",\"doc_hash\":\"$DOC_HASH\"}" \
    '100 Tgas' '0.05 NEAR' "$ISSUER")
  case "$ID" in
    *[!0-9]*|"") die "create_invoice returned no id, got: ${ID:-<empty>}" ;;
  esac
}

accept() { # id invite_sk
  local msg sig
  # The contract is asked for the exact message rather than rebuilding it here. It binds
  # the contract, the invoice, the caller and the action, and if this script and the
  # verifier disagreed every accept would fail for reasons nobody could see.
  # The argument is `account`, not `account_id`. Getting that wrong makes the view fail,
  # `view`'s `|| true` swallows it, and an empty message gets signed, which the contract
  # then rejects as a bad signature with no hint as to why.
  msg=$(view "$CONTRACT" invite_message \
    "{\"id\":\"$1\",\"account\":\"$CLIENT\",\"action\":\"accept\"}" | tr -d '"')
  [ "$msg" = "ileri:v1:$CONTRACT:$1:$CLIENT:accept" ] \
    || die "invite_message gave an unexpected message: ${msg:-<empty>}"
  sig=$("$NODE_BIN" "$ROOT/scripts/invite-key.mjs" sign "$2" "$msg")
  call "$CONTRACT" accept_invoice "{\"id\":\"$1\",\"invite_sig\":\"$sig\"}" \
    '100 Tgas' '0 NEAR' "$CLIENT"
}

pay() { # id amount
  call "$TOKEN" ft_transfer_call \
    "{\"receiver_id\":\"$CONTRACT\",\"amount\":\"$2\",\"msg\":\"{\\\"action\\\":\\\"pay\\\",\\\"invoice_id\\\":\\\"$1\\\"}\"}" \
    '300 Tgas' '1 yoctoNEAR' "$CLIENT"
}

# --- go -------------------------------------------------------------------------------

step "Seeding $CONTRACT as $ISSUER, client $CLIENT"
for who in "$ISSUER" "$CLIENT"; do
  # Both must be registered on the token: the client to pay, the issuer to receive. An
  # unregistered issuer would get a claimable balance instead of a payout, which is a real
  # path the app handles but a confusing thing to seed into a demo.
  call "$TOKEN" storage_deposit "{\"account_id\":\"$who\",\"registration_only\":true}" \
    '30 Tgas' '0.0125 NEAR' "$TOKEN" 2>/dev/null || true
done
call "$TOKEN" mint "{\"account_id\":\"$CLIENT\",\"amount\":\"$(usdc 20000)\"}" \
  '30 Tgas' '0 NEAR' "$TOKEN"
ok "client funded with test USDC"

step "1 of 5: awaiting the client"
make_invoice "$(usdc 640)" 20
ok "invoice $ID, 640.00 USDC, Issued"

step "2 of 5: accepted"
make_invoice "$(usdc 1800)" 16
accept "$ID" "$SK"
ok "invoice $ID, 1,800.00 USDC, Accepted"

step "3 of 5: part paid"
make_invoice "$(usdc 2400)" 9
accept "$ID" "$SK"
pay "$ID" "$(usdc 600)"
ok "invoice $ID, 2,400.00 USDC, 600.00 in"

step "4 of 5: listed for sale"
make_invoice "$(usdc 4250)" 37
accept "$ID" "$SK"
# The price must sit below the unpaid balance or the contract refuses the listing.
call "$CONTRACT" list_invoice "{\"id\":\"$ID\",\"price\":\"$(usdc 3900)\"}" \
  '100 Tgas' '0 NEAR' "$ISSUER"
ok "invoice $ID, 4,250.00 USDC, on the market at 3,900.00"

step "5 of 5: settled"
make_invoice "$(usdc 980)" 30
accept "$ID" "$SK"
pay "$ID" "$(usdc 980)"
INV=$(view "$CONTRACT" get_invoice "{\"id\":\"$ID\"}")
[ "$(json_field "$INV" status)" = "Paid" ] || die "invoice $ID should be Paid"
ok "invoice $ID, 980.00 USDC, Paid in full"

step "Done"
ok "five invoices added for $ISSUER"
printf '    open http://localhost:3000/app signed in as %s\n' "$ISSUER"
printf '    and http://localhost:3000/market for the listing\n'
