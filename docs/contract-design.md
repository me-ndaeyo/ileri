# Ileri Contract Design (NEAR Hackathon)

Nov 9, 2026 · @Romanus

## Purpose

One Rust contract on NEAR (`ileri`) holds every invoice as an NFT, takes payments for it, and sends the money to whoever holds the NFT at that moment. The web app, Intents payments and the marketplace all sit on top of it, so this spec is what gets built and tested on day 1.

This doc is the blueprint for: writing the contract (or handing it to Claude Code), writing its tests, and the README section that the AI screeners and judges read.

**Stack:** `near-sdk` 5.x, `near-contract-standards` for NEP-171 (core), NEP-177 (metadata) and NEP-181 (enumeration). NEP-178 approvals are disabled, since the marketplace lives inside the contract. Payment token is any NEP-141 token on an allowlist set at init (USDC on NEAR for the demo).

## Data model

Each invoice is one NFT (`token_id` = invoice id) plus one `Invoice` record. Status is stored; Overdue is computed at read time, so no keeper bot is needed.

```rust
pub struct Invoice {
    pub issuer: AccountId,
    pub client: AccountId,
    pub token: AccountId,          // NEP-141 payment token, must be on allowlist
    pub amount: U128,              // total due
    pub paid: U128,                // total received so far
    pub due_date: u64,             // nanoseconds
    pub doc_hash: [u8; 32],        // sha256 of the offchain invoice file
    pub status: Status,
    pub created_at: u64,
    pub accepted_at: Option<u64>,
    pub paid_at: Option<u64>,
    pub reject_reason_hash: Option<[u8; 32]>,
    pub storage_deposit: U128,     // paid by issuer at mint, refunded on close
    pub listing: Option<U128>,     // sale price in the invoice's token, None = not listed
}

pub enum Status { Issued, Accepted, Rejected, Cancelled, PartiallyPaid, Paid }
```

Other storage:

| Map | Key | Value | Used for |
| --- | --- | --- | --- |
| `invoices` | invoice id | `Invoice` | all invoice state |
| `reputation` | AccountId | `Rep` counters | issuer and client history |
| `claimable` | (AccountId, token) | U128 | payouts that failed to push |
| `allowed_tokens` | token AccountId | () | payment token allowlist |

NFT metadata stays generic (`title: "Invoice #42"`, no names, no amounts) so wallets and explorers show nothing private.

## Lifecycle

&#91;embedded content: invoice lifecycle · 6 states\]

An invoice can take payments before the client accepts, but it only becomes tradable after acceptance. Paying an Issued invoice in full counts as acceptance and goes straight to Paid. Reject and cancel are only allowed while nothing has been paid. Overdue is not stored: any Accepted or Partially paid invoice past its due date shows as Overdue in views.

## Methods by role

Every state-changing call checks `predecessor_account_id()` against the role below. With meta transactions (NEP-366) the predecessor is still the signer, so gasless calls need no special handling.

| Method | Who can call | Allowed when | Effect |
| --- | --- | --- | --- |
| `create_invoice(client, token, amount, due_date, doc_hash)` payable | anyone (becomes issuer) | client != issuer, amount > 0, due\_date > now, token allowlisted, deposit covers storage | mints NFT to issuer, status Issued |
| `cancel_invoice(id)` | issuer | Issued and paid == 0 | status Cancelled |
| `accept_invoice(id)` | client | Issued | status Accepted, or PartiallyPaid if paid > 0 |
| `reject_invoice(id, reason_hash)` | client | Issued and paid == 0 | status Rejected |
| `list_invoice(id, price)` | current holder | Accepted or PartiallyPaid, not fully paid | sets listing |
| `unlist_invoice(id)` | current holder | listed | clears listing |
| `close_invoice(id)` | issuer (Rejected, Cancelled) or holder (Paid) | final state | burns NFT, refunds storage deposit to issuer |
| `withdraw_claimable(token)` | anyone with a balance | balance > 0 | pushes stuck payout |
| `nft_transfer(...)` | holder | Accepted or PartiallyPaid | standard transfer, clears listing |
| `ft_on_transfer(sender_id, amount, msg)` | allowlisted token contract only | see Payment routing | pay or buy |

**Views:** `get_invoice(id)`, `invoices_for_issuer(acc)`, `invoices_for_client(acc)`, `nft_tokens_for_owner(acc)`, `get_listings(from, limit)`, `get_reputation(acc)`, `get_claimable(acc, token)`. Every invoice view returns `status` with Overdue computed (`now > due_date` and not Paid).

## Payment routing

All money enters through `ft_on_transfer`, and every rejected or excess amount goes back through its return value, which NEP-141 refunds to the sender automatically. No manual refund code, no stuck funds.

`msg` is JSON: `{"action":"pay","invoice_id":"42"}` or `{"action":"buy","invoice_id":"42"}`.

**Pay flow:**

1. Check `predecessor_account_id()` is on the allowlist and equals `invoice.token`. Otherwise return the full amount.
2. Check status is Issued, Accepted or PartiallyPaid. Rejected, Cancelled or Paid: return the full amount.
3. `applied = min(amount, invoice.amount - invoice.paid)`; `excess = amount - applied`.
4. `paid += applied`. If now fully paid: status Paid, set `paid_at`, clear any listing, update reputation (on time or late). If paid on an Issued invoice in full, that counts as acceptance (`accepted_at` set). Partial on an Accepted invoice: PartiallyPaid. Partial on an Issued invoice: stays Issued, so it still can't be traded until the client accepts.
5. Push `applied` to the current NFT holder with `ft_transfer`, plus a callback `on_payout`.
6. Return `excess` (refunded to sender).

**Payout failure:** if the holder isn't registered on the token contract, `ft_transfer` fails. `on_payout` catches it and adds the amount to `claimable[(holder, token)]`. The holder calls `withdraw_claimable` after registering. Push for the demo, pull as the safety net.

**Holder changes mid-way:** each payment goes to whoever holds the NFT at that moment. A buyer of a part-paid invoice only gets what's still unpaid, which the listing shows.

## Marketplace (factoring)

The sale happens inside the contract in one atomic step: buyer pays, seller gets paid, NFT moves. No external marketplace, no approvals to manage.

1. Holder calls `list_invoice(id, price)`. Price is in the invoice's own token and must be below the unpaid balance (otherwise nobody should buy it).
2. Buyer sends the price with `ft_transfer_call` and `msg = {"action":"buy","invoice_id":"42"}`.
3. Contract checks: listed, still tradable, sender is not the current holder, `amount >= price`.
4. Contract moves the NFT to the buyer (internal transfer, emits NEP-171 `nft_transfer` event), clears the listing, pushes `price` to the seller via `ft_transfer` with the same `on_payout` fallback, and returns any excess.
5. Future payments on the invoice now go to the buyer.

The listing view shows what a buyer needs to price risk: amount, paid, unpaid, due date, accepted or not (always yes, since only accepted invoices list), and the client's reputation. No platform fee for the hackathon.

## Privacy

The contract stores only what it needs to enforce rules; the invoice itself stays offchain and encrypted. Be upfront in the README that account IDs and amounts are public.

| Data | Where | Who can read |
| --- | --- | --- |
| Issuer, client, holder account IDs | onchain | anyone |
| Amount, paid, token, due date, status | onchain | anyone |
| Invoice file (names, line items, notes, bank refs) | offchain, encrypted | issuer, client, current holder |
| `doc_hash` of that file | onchain | anyone (proves the file wasn't changed) |
| Reject reason text | offchain | issuer, client |
| NFT title and image | onchain | anyone, generic only |

**Offchain access check:** the app decrypts the file only after the reader signs a message with their NEAR key, and the server checks that account is the issuer, the client, or `nft_token(id).owner_id` right now. When the invoice is sold, the old holder loses access automatically.

Hiding amounts too (NEAR Business confidential treasury, or private inference via NEAR AI Cloud) is a stretch goal, not day-one scope.

## Reputation

Each account gets plain counters, updated by the contract at each state change. No scores, no formula: the app shows the raw numbers and buyers judge.

| Counter | Increments when |
| --- | --- |
| `issued` | account creates an invoice |
| `rejected_as_issuer` | client rejects one of its invoices |
| `cancelled` | account cancels its own invoice |
| `accepted_as_client` | account accepts an invoice |
| `rejected_as_client` | account rejects an invoice |
| `paid_on_time` | an invoice where account is client is fully paid on or before `due_date` |
| `paid_late` | same, after `due_date` |
| `volume_paid` | per token, total settled on invoices where account is client |

Defaults are not a counter, since "overdue" can still turn into paid. The app shows open overdue invoices per client as a live count from the views.

## Security checklist

The biggest risk is a spoofed `ft_on_transfer`: anyone can call it directly and claim they sent tokens. Every item below gets a unit or sandbox test.

- [ ] `ft_on_transfer` rejects any caller that isn't an allowlisted token contract, and any token that isn't `invoice.token`
- [ ] All state changes in `ft_on_transfer` happen before the outgoing `ft_transfer` (no stale state if the callback runs later)
- [ ] `on_payout` is `#[private]` and only credits `claimable` on failure, never double-credits
- [ ] Checked math on every U128 (`checked_add`, `checked_sub`), panic on overflow
- [ ] Role checks on accept, reject, cancel, list, unlist, close (predecessor, not signer)
- [ ] `nft_transfer` and `nft_transfer_call` overridden to block transfers unless accepted and not Paid; listing cleared on every transfer
- [ ] Approvals (NEP-178) disabled so no third party can move an invoice
- [ ] Storage: mint requires attached deposit >= bytes used x storage price; refund only once, on close
- [ ] Buyer can't buy own listing; price must be below unpaid balance
- [ ] Payment to a Rejected, Cancelled or Paid invoice returns the full amount
- [ ] `due_date` must be in the future at creation; `client != issuer`
- [ ] Contract owner can only edit the token allowlist; no admin path to move funds or invoices

## Day-1 Intents check

The main path looks workable: the 1Click quote API has a `customRecipientMsg` field that makes 1Click deliver to NEAR with `ft_transfer_call` instead of `ft_transfer`, so our `ft_on_transfer` receives the invoice ID ([1Click quote docs](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote)). It is marked highly experimental, and funds are lost if the recipient lacks `ft_on_transfer` or a storage deposit, so day 1 is about proving it with tiny amounts.

**Plan A (native):** quote with `recipient = invoice contract`, `destinationAsset = USDC on NEAR`, `customRecipientMsg = {"action":"pay","invoice_id":"42"}`, `swapType = EXACT_OUTPUT` for the unpaid amount. Client sends to the quote's deposit address on their chain.

Day-1 checks, in order:

- [ ] Contract account has a `storage_deposit` on the USDC contract before any test
- [ ] Dry quote (`dry: true`) with `customRecipientMsg` returns a valid quote
- [ ] Real payment of \~1 USDC from Base or Arbitrum lands, `ft_on_transfer` fires, invoice shows paid
- [ ] Note who `sender_id` is (likely the Intents contract, not the payer). Refunds of excess go back to that sender, not the payer, so EXACT\_OUTPUT quotes are used to make excess near zero
- [ ] Rejected-invoice case: confirm what happens to the returned amount

**Plan B (fallback, disclosed in README):** 1Click delivers plain USDC to a relayer account the app controls. The relayer watches 1Click status by deposit address, then calls `ft_transfer_call` on the contract with the invoice ID. Briefly custodial, but the demo and the contract stay the same.

Native NEAR payers (already holding USDC on NEAR) skip Intents and call `ft_transfer_call` directly. Without a 1Click JWT there is a 0.2% fee; register at partners.near-intents.org if time allows.

## Out of scope

These stay out of the 5-day build and get one line each in the README as next steps:

- Disputes after acceptance (client accepts, then contests the work)
- Hiding amounts and parties onchain
- Multiple tokens or currencies per invoice, and fiat offramp
- Partial sale of an invoice (selling a share of future payments)
- Recourse or insurance for buyers when a client never pays
- Platform fees
