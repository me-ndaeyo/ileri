# Ileri

**Getting paid is the slowest part of freelancing, and waiting is not optional.** Ileri
issues an invoice as an NFT on NEAR, lets the client pay it from any chain, and lets the
freelancer sell it to a buyer before the due date. Payment always goes to whoever holds the
invoice, so a sale needs nobody to remember to redirect anything.

Ileri is Yoruba for promise. An invoice that pays its bearer is a promissory note, which is
the oldest financial object there is, and the whole design follows from that.

Built for NEAR HACKATHON. Tracks: `realworld`, `nfts`, `defi`.

**Testnet contract:** [`ileri.testnet`](https://testnet.nearblocks.io/address/ileri.testnet)
· payment token [`usdc.ileri.testnet`](https://testnet.nearblocks.io/address/usdc.ileri.testnet)
· **no mainnet deployment** (see [What is real](#what-is-real-and-what-is-not))

## The NEAR pieces

| Piece | Where |
| --- | --- |
| NEP-171 core, NEP-177 metadata, NEP-181 enumeration | `contract/src/nft.rs`, written by hand because transfers are guarded by invoice state |
| NEP-178 approvals | **deliberately not implemented**, so no third party can move an invoice |
| NEP-141 `ft_on_transfer` | `contract/src/payments.rs`, the single door all money enters through |
| NEP-297 events | `contract/src/events.rs`, so the UI reads history from the chain rather than our database |
| NEP-413 signed messages | `app/lib/nep413.ts`, sign-in proves key ownership with no transaction and no gas |
| NEAR Intents 1Click | `app/lib/oneclick.ts`, for paying from another chain. **Not yet proven, see below** |
| NEAR Connect | `app/lib/wallet.ts`, wallet selection and signing |

## Try it

About ten minutes. **Steps 1 to 3 need no keys, no accounts and no funds.**

| # | Do | See |
| --- | --- | --- |
| 1 | `make setup` | The toolchain gate reports rustc, cargo-near, near CLI and Node 24 |
| 2 | `make test` | 196 contract unit tests, 5 sandbox tests against a real NEAR node, 111 app tests. No network accounts needed: the sandbox starts its own node |
| 3 | `curl -s localhost:3000/api/nft/1/image.svg` after `make dev` | The token image for invoice 1, generated from its serial, with its real status read from `ileri.testnet` |
| 4 | `make dev`, open `localhost:3000` | The landing page. Press **Walk through one invoice** and step through the whole life of one invoice, including the payment that redirects itself |
| 5 | Connect a testnet wallet, **Issue an invoice** | An invoice minted to you as an NFT, and a private invite link to send |
| 6 | Open the invite link in another browser profile, connect a second testnet account, **Accept invoice** | The second account is written onto the invoice as the client. The key in the link never reaches our server |
| 7 | **Pay** with test USDC | The contract records the payment and forwards it to the holder in the same call. The page says paid only once the contract's `paid` equals `amount` |
| 8 | From the issuer, **List for sale** below the unpaid balance, then buy it from the second account | The NFT moves, the listing clears and the seller is paid in one transaction |
| 9 | Pay the rest | It goes to the **buyer**, not the issuer. This is the point of the whole project |

To watch the same journey on chain instead of in a browser, `make walkthrough` runs it
against `ileri.testnet` with 24 assertions. That one needs funded testnet keys on disk.

## Fit to track

| Track | What it asks | What Ileri does | Code | How it is checked |
| --- | --- | --- | --- | --- |
| `realworld` | A real problem, solved for real people | Invoicing and getting paid, for freelancers whose clients are not on NEAR and may hold no crypto at all. The client needs no wallet and no account to pay | `app/app/i/[id]`, `app/app/pay/[id]` | Steps 6 and 7 above |
| `nfts` | NFTs doing something beyond collecting | The invoice **is** the NFT. Holding the token is the entitlement to be paid, so a transfer moves a cash flow rather than a picture. The image is generated from the token id, so it is public without leaking a name, an amount or a counterparty | `contract/src/nft.rs`, `app/lib/instrument-svg.ts` | `cargo test nft_metadata_leaks_nothing_private`, `app/lib/instrument-svg.test.ts` |
| `defi` | Real financial primitives | Invoice factoring. A holder lists below the unpaid balance; a buyer takes on the risk for the gap. Settlement is one atomic `ft_on_transfer`: buyer pays, NFT moves, seller is paid, listing clears | `contract/src/market.rs`, `app/components/BuyInvoice.tsx` | Step 8, plus `make test-sandbox` |

## What is real and what is not

The honest list. Nothing below is hidden anywhere else in this README.

**Not finished:**

- **Paying from another chain is not proven.** NEAR Intents has no testnet, so it cannot be
  exercised without mainnet funds. It is built: the token list, the quote, both delivery
  routes behind `PAY_ROUTE`, and the selector on `/pay/[id]`, which lists the 45 routes
  1Click actually supports. On testnet the quote route answers 409 and says why. What is
  unverified is the delivery itself: `customRecipientMsg` is marked "HIGHLY EXPERIMENTAL"
  upstream, with a documented warning that funds are lost if the recipient lacks
  `ft_on_transfer` or a storage deposit. Until a mainnet check with about one dollar has
  run, treat it as written and unverified. Paying with USDC already on NEAR works today and
  is tested.
- **No mainnet deployment and no hosted demo.** Everything runs locally against testnet.
- **No demo video yet.**
- **Token images are not live on chain.** The contract sets each token's `media` and the
  owner can set the base URI, but that change has not been deployed, and only invoices
  minted after a redeploy would carry it.
- **Gasless payment is not built.** NEP-366 meta transactions, the relayer and the sponsor
  account are in the plan and not in the code.
- **No account profile page.** Reputation counters are read and shown on a listing, but
  `/u/[account]` does not exist.

**True and worth knowing:**

- **Account ids, amounts, due dates and status are public on chain.** Anyone can read them
  with `get_invoice`. Names, line items, notes and the reject reason live in an encrypted
  file offchain, and the chain keeps only its sha256 so it can be proved unchanged. The app
  is stricter than the chain: `/app/invoice/[id]` returns the same 404 to a stranger as a
  missing invoice would, so it will not even confirm that an invoice exists. The chain will.
- **Token ids are sequential, which makes that public data easy to harvest.** Walking
  `1..n` builds a map of who bills whom for how much. The data was already public, so this
  is not a leak, but it turns "public if you know the id" into "trivially enumerable",
  which is a meaningfully worse thing. Opaque ids would fix it and are a contract change
  that was not worth making late in the build. Worth knowing before putting a real client
  on this.
- **The server sees an invoice's plaintext while it serves it.** Decryption happens server
  side after checking the reader is the issuer, the client, or the current holder. It is not
  end-to-end encrypted and does not claim to be.
- **The invite link's key lives only in the URL fragment**, so browsers never send it to a
  server. Whoever holds that link can accept the invoice, which is the trade for a client
  needing no account. The issuer can rotate it while the invoice is unaccepted.
- **`usdc.ileri.testnet` is a toy token** with an open mint, used only by the sandbox tests
  and the testnet walkthrough. It must never be deployed anywhere real.
- **No recourse on a sale.** If a client never pays, whoever holds the invoice carries the
  loss. There is no insurance and a purchase cannot be undone. The market says so on every
  listing rather than in the small print.
- **No platform fee**, on an invoice or a sale.

## Tests

```bash
make test          # everything: contract unit, contract sandbox, then the app
make test-unit     # the fast loop, contract unit tests only
make test-sandbox  # end to end against a real NEAR node
make lint          # clippy with -D warnings, and eslint
```

312 tests in all. What they cover, and the ones worth looking at:

- **Spoofed payments, written before the handler they attack.** `ft_on_transfer` rejects any
  caller that is not an allowlisted token, and any token that is not the invoice's own, and
  each of those tests asserts that **no state changed**, not merely that the money came
  back. `contract/src/payments.rs`
- **Invite signature replay, four ways.** The signed message binds contract, invoice,
  caller and action, so a signature cannot be replayed across any of them. There is a test
  per axis, including the front-running case where somebody else's signature is used.
  `contract/src/invite.rs`
- **The browser and the contract agree.** An integration test proves `@noble/ed25519`
  produces signatures that `env::ed25519_verify` accepts. If they disagreed, every accept
  would fail with `E_BAD_SIGNATURE` and nothing would say why. `app/lib/accept.integration.test.ts`
- **The browser's `doc_hash` matches the chain's.** Otherwise an invoice mints fine and its
  document is unservable forever. `app/lib/invoice.integration.test.ts`
- **Money is never a float.** `app/lib/money.test.ts`, including the amount written out in
  words on the sheet, which must never round a fraction away.
- **The token image leaks nothing.** `app/lib/instrument-svg.test.ts` asserts no account,
  amount or date can reach the public image, at u64-max token ids.
- **Payout failure.** A holder not registered on the token gets a `claimable` balance
  instead of a stuck transfer, and a success never double-credits it.

## How it is put together

```
contract/        Rust, near-sdk 5.30.1. One module per aggregate, each with its own #[near] impl
  src/nft.rs       NEP-171/177/181 by hand; transfers guarded, approvals absent
  src/payments.rs  ft_on_transfer: the only way money enters. State first, then the transfer
  src/market.rs    list, unlist, and the atomic buy
  src/invite.rs    the signed message, and the four things it binds
  tests/           sandbox tests against a real node
test-token/      A toy NEP-141 for tests. Never deploy this
app/             Next.js 16, App Router, Cache Components
  lib/money.ts     every arithmetic operation on an amount, and nothing else does any
  lib/near.ts      contract views. The contract is the only source of truth for money
  lib/invite.ts    the invite keypair, generated and kept in the browser
scripts/         deploy, and the 24-assertion testnet walkthrough
docs/            the contract design, the implementation plan, the design system
```

Two rules the code holds everywhere, and they are the ones to check if you read anything:

1. **The contract is the only source of truth for money and status.** The UI shows "Paid"
   when the contract's `paid` equals `amount`, never from a payment provider's status or
   from our database. `app/components/PayInvoice.tsx` re-reads the contract after its own
   transaction rather than trusting it.
2. **Money is a string or a `bigint`, never a float**, and every helper lives in
   `app/lib/money.ts`. A double cannot hold 1,200.07 USDC exactly, and the contract decides
   an invoice is settled by comparing for equality.

The design was worked out on a canvas before any of it was built, and is written down in
[`docs/design-system.md`](docs/design-system.md).

## Built at NEAR HACKATHON

- First commit **10 November 2026**. Everything in this repository was written during the
  hackathon.
- Tags: [`pre-hackathon`](../../releases/tag/pre-hackathon) marks the starting point, which
  is an empty repository with only the design docs.
- **AI assistance:** built with Claude Code, under review. It wrote most of the contract,
  the app and the tests. Where a decision was made for a reason, the reason is in the
  commit message or in `docs/`, which is the audit trail.
- Third-party libraries, and what was decided against: [`LIBRARIES.md`](LIBRARIES.md)
- Licence: [MIT](LICENSE)
- Solo entry. No second project.
