# Ileri: Implementation Plan

Nov 10, 2026 · @Romanus

## Summary

Ileri (Yoruba for "promise") is one Next.js app (UI plus API routes), one Rust contract on NEAR, one Postgres database, and two outside services: NEAR Intents 1Click for cross-chain payments and NEAR RPC. The contract is the only source of truth for money and status; the database only stores encrypted invoice files and payment tracking.

Five decisions shape everything else:

1. **The payer needs nothing.** No NEAR account, no wallet connection. They pick a chain and token, get a deposit address and send from any wallet or exchange.
2. **The client doesn't need a NEAR account when the invoice is made.** The issuer sends an invite link holding a one-time key. The client opens it, signs in (or gets an account created), and the contract binds their account on accept. This replaces "issuer must know the client's account ID", which would kill real usage.
3. **Gasless for users.** Users sign NEP-366 delegate actions through NEAR Connect and our relayer pays the gas, only for calls to our contract or USDC. Gas sponsorship can't cover the mint storage deposit (about 0.01 NEAR), so new accounts get a one-time 0.02 NEAR top-up. Wallets that can't sign delegate actions fall back to a normal transaction.
4. **Invoice files are encrypted at rest and only decrypted for the issuer, the client and the current holder,** after a signed login. The server sees plaintext while serving it; the README says so plainly.
5. **Chain decides, server follows.** "Paid" on screen always comes from a contract view or event, never from 1Click status or the database alone.

Related: the [Ileri Contract Design](https://claude.ai/artifact/UZt7ZbV8geuSEGjeHfoshD). Decision 2 needs a small contract change, listed near the end.

## Architecture

&#91;embedded content: architecture · 9 parts and their connections\]

Users sign every state change in their own wallet, so the server can never move money or invoices. The server only reads the contract (dashed line) to check roles and payment status, stores encrypted files, and asks 1Click for quotes. The payer never touches our app's wallet flow: they send to a 1Click deposit address, and 1Click delivers USDC into the contract.

## Roles and sign-in

Only the payer is anonymous; everyone who sees invoice details or changes state signs in with a NEAR wallet through NEAR Connect and proves it with a NEP-413 signed message ([NEAR Connect docs](https://docs.near.org/web3-apps/tutorials/wallet-login)).

| Role | Who | Needs | Signs in with | Can do |
| --- | --- | --- | --- | --- |
| Issuer | freelancer or business sending the invoice | NEAR wallet, no NEAR needed (top-up covers mint storage) | NEAR Connect + NEP-413 | create, cancel, list, see file, withdraw |
| Client | company being billed | invite link; NEAR wallet or one created on the spot | invite key, then NEAR Connect + NEP-413 | view, accept, reject |
| Payer | anyone paying (usually the client's finance person) | any wallet or exchange on a supported chain | nothing | pay via deposit address |
| Holder | whoever owns the invoice NFT now | NEAR wallet | NEAR Connect + NEP-413 | see file, list, unlist, receive payouts |
| Buyer | investor buying invoices | NEAR wallet holding USDC | NEAR Connect + NEP-413 | browse market, buy |

**Session:** after the signature checks out, the server sets an httpOnly, Secure, SameSite=Lax cookie holding a short-lived signed session (12 hours) with the account ID. Every API call that touches private data re-checks the role against the contract at that moment, so a sold invoice stops being visible to the old holder immediately.

**Libraries:** `@hot-labs/near-connect` with `near-connect-hooks` for React, `near-api-js` for view calls and signature checks. Social login (Privy or Web3Auth) is a stretch goal for clients who have never used crypto.

## User journeys

The demo follows these four journeys in order: issue, accept, pay from another chain, sell.

**Issuer: create and send an invoice**

1. Connect wallet, sign the login message.
2. Fill the form: client name and email (offchain only), line items, due date, notes. Currency is USDC.
3. Browser builds the invoice JSON, computes `sha256` (the `doc_hash`), and generates a one-time invite keypair. The invite private key never leaves the browser except inside the link.
4. Browser uploads the invoice JSON to `/api/drafts`; server encrypts and stores it as a draft.
5. Wallet prompt: `create_invoice(amount, due_date, doc_hash, invite_pk)` with the storage deposit attached.
6. Server confirms the mint by reading the invoice from the contract and checking `doc_hash` matches, then links the draft to the invoice ID.
7. Success screen shows the invite link once: `/i/42#k=<invite private key>`. Copy, or share to WhatsApp or email. If lost, the issuer rotates the invite (new keypair, old link dies).

**Client: review, then accept or reject**

1. Opens the link. The key sits after `#`, so it is never sent to the server or logged.
2. Browser signs a server challenge with the invite key; server checks it against `invite_pk` onchain and returns the decrypted invoice. Browser re-hashes it and shows a "matches what's onchain" check.
3. Client connects a NEAR wallet (or creates one); new accounts get the 0.02 NEAR top-up.
4. Accept: browser signs `(invoice_id, client_account)` with the invite key, then the wallet sends `accept_invoice(42, signature)`. The contract verifies the signature and binds this account as client. Reject works the same way with an optional reason.
5. After accepting, the client sees a Pay button and a "send payment link to finance" option.

**Payer: pay from any chain**

1. Opens `/pay/42` (no login). Sees issuer, amount due, due date. No line items.
2. Picks chain and token (USDC on Base, Arbitrum, Ethereum or Solana, or USDT on Tron), enters a refund address on that chain.
3. Gets a deposit address, QR code, exact amount and a countdown to the quote deadline.
4. Sends from any wallet or exchange. Page moves through: waiting for deposit, swapping, delivering, Paid (the last step only once the contract says so).

**Holder and buyer: sell an invoice early**

1. Holder opens an accepted invoice, taps Sell, enters a price. The form shows the discount and what it means as a yearly rate given the days to due date.
2. Wallet prompt: `list_invoice(42, price)`.
3. Buyer browses `/market`: amount, unpaid, price, discount, days to due, client's record (accepted, paid on time, paid late). No invoice file before purchase.
4. Buyer taps Buy; wallet prompt sends USDC with `ft_transfer_call` and the buy message. NFT moves, seller is paid in the same step.
5. The invoice now shows in the buyer's portfolio with file access; later payments go to them.

## Screens and API

Nine pages and eleven API routes cover every journey. Pages under `/app` need a session; `/i`, `/pay` and `/market` work logged out.

| Route | Who | Shows | Calls |
| --- | --- | --- | --- |
| `/` | everyone | what it does in one line, Create invoice, Pay an invoice, Market | none |
| `/app` | signed in | three tabs: Sent, Received, Owned. Status pill, amount, due, paid bar. Claimable banner if a payout is stuck | contract views |
| `/app/new` | issuer | form on the left, live invoice preview on the right | `/api/drafts`, `create_invoice` |
| `/app/invoice/[id]` | issuer, client, holder | full invoice, onchain check, event timeline, actions for this role only | file API, cancel, rotate invite, list, unlist, close |
| `/i/[id]` | client via invite | invoice preview, Accept and Reject, wallet connect | invite API, sponsor API, accept or reject |
| `/pay/[id]` | anyone | amount due, chain and token picker, refund address, deposit address with QR, live status | pay API |
| `/market` | anyone | listings table: amount, unpaid, price, discount, days left, client record | contract views |
| `/market/[id]` | anyone, buy needs sign-in | listing detail and Buy | `ft_transfer_call` on USDC |
| `/u/[account]` | anyone | public record for an account: issued, accepted, rejected, paid on time, paid late | contract views |

| API route | Auth | Does |
| --- | --- | --- |
| `POST /api/auth/challenge` | none | returns a one-use nonce (expires in 5 min) |
| `POST /api/auth/verify` | signed nonce | checks NEP-413 signature and that the key belongs to the account, sets session |
| `POST /api/auth/logout` | session | clears session |
| `POST /api/drafts` | session | encrypts and stores invoice JSON as a draft owned by this account |
| `POST /api/drafts/link` | session | links draft to invoice ID after checking the contract's `doc_hash` and issuer |
| `GET /api/invoices/[id]/file` | session or invite proof | returns decrypted invoice if caller is issuer, client or current holder |
| `POST /api/invite/challenge` | none | nonce for the invite key to sign |
| `POST /api/invite/verify` | signed nonce | checks against `invite_pk` onchain, returns a 15-min invite token |
| `POST /api/sponsor` | invite token + session | sends 0.02 NEAR once per invoice, only to accounts with balance under 0.01 |
| `POST /api/pay/quote` | none, rate limited | asks 1Click for a quote with our JWT, stores deposit address |
| `GET /api/pay/status/[address]` | none | 1Click status for that deposit plus the contract's paid amount |

**Relayer:** `POST /api/relay` (session required) takes the signed delegate from `signDelegateActions`, checks it, and submits it with the relayer paying gas ([NEAR relayer docs](https://docs.near.org/chain-abstraction/meta-transactions-relayer)). It only accepts: sender equal to the session account; receiver equal to the invoice contract, or USDC with `ft_transfer_call` to the invoice contract; FunctionCall actions on a method allowlist; attached deposit only on `create_invoice` (up to 0.02 NEAR, paid from the user's own balance) or 1 yoctoNEAR on USDC; at most 100 Tgas per action; a short block-height expiry. Limit 20 relays per account per hour. Anything else is rejected without being sent.

## Payment flow

A cross-chain payment touches four systems and only the contract can say it's done. The biggest money risk is two payers paying the same invoice at once, so the server allows one open quote per invoice.

1. Payer picks chain, token and refund address on `/pay/42`.
2. Browser calls `POST /api/pay/quote`. Server checks: invoice is payable (contract view), no other open quote for it, rate limit per IP.
3. Server asks 1Click for a quote ([1Click quote docs](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote)): `swapType: EXACT_OUTPUT`, `amount` = unpaid balance, `destinationAsset` = USDC on NEAR, `recipient` = invoice contract, `customRecipientMsg` = `{"action":"pay","invoice_id":"42"}`, `refundTo` = payer's address, JWT from server env.
4. Server stores the deposit address, deadline and invoice ID, marks the invoice "quote open" until the deadline, and returns address, amount and deadline.
5. Payer sends funds. If they never send, the lock expires at the deadline. If the swap fails, 1Click refunds to their refund address.
6. Page polls `GET /api/pay/status/[address]` every 5 seconds: 1Click status for the progress steps, plus the contract's `paid` for the final step.
7. 1Click delivers USDC with `ft_transfer_call`; the contract's `ft_on_transfer` records the payment, pushes it to the current holder and emits the event.
8. Page shows Paid only when the contract's `paid` equals `amount`. 1Click saying SUCCESS alone is never enough.

**Edge cases handled in the UI**

| Case | What the payer sees | Why it's safe |
| --- | --- | --- |
| Quote deadline passes | "Quote expired, get a new one" | 1Click refunds late deposits to the refund address |
| Someone else is paying | "A payment is in progress, try again in N min" | stops double payment, whose excess would go back to the Intents sender, not the payer |
| Invoice rejected or cancelled | no Pay button | contract also returns any funds |
| Native NEAR payer | "Pay with NEAR wallet" button instead | direct `ft_transfer_call`, no 1Click |
| Wrong amount sent to deposit address | 1Click status shows it | 1Click refunds deposits it can't fill to the refund address (confirm exact behaviour for short and over deposits on day 1) |

## Data and storage

The database holds no user table and no plaintext invoice data. Losing the database loses invoice files and open quotes, never money or invoice status.

| Where | What | Notes |
| --- | --- | --- |
| Contract | invoices, status, amounts, holders, listings, reputation, invite public keys | source of truth |
| Postgres `invoice_files` | draft or linked invoice ID, issuer, ciphertext, IV, key version, `doc_hash` | drafts not linked within 24 h are deleted |
| Postgres `auth_nonces` | nonce, purpose (login or invite), subject, expiry, used time | one use, 5 min expiry |
| Postgres `pay_quotes` | deposit address, invoice ID, origin asset, amount, deadline, status | unique index: one open quote per invoice |
| Postgres `sponsor_drips` | invoice ID (unique), account, tx hash | caps top-ups to one per invoice |
| Browser cookie | signed session: account ID, expiry | httpOnly, no account data in JS |
| Browser memory | invite private key, read from `#` then removed from the address bar | never in localStorage, never sent to server |

**Encryption:** AES-256-GCM per file with a random 12-byte IV and the file's row ID as associated data, so a ciphertext can't be swapped into another row. Key comes from `FILE_ENC_KEY`, tagged with a version so it can be rotated. After decrypting, the server re-hashes and refuses to serve the file if it doesn't match the onchain `doc_hash`.

**Hosting:** Vercel for the app, Neon for Postgres (server-only connection through its serverless driver, nothing exposed to the browser). Contract on testnet for development and mainnet for the demo, since Intents is mainnet-only.

**Server secrets (env only):** `ONECLICK_JWT`, `FILE_ENC_KEY`, `SESSION_SECRET`, `SPONSOR_ACCOUNT_ID`, `SPONSOR_PRIVATE_KEY`, `DATABASE_URL`, `NEAR_RPC_URL`, `CONTRACT_ID`. Add RELAYER\_ACCOUNT\_ID and RELAYER\_PRIVATE\_KEY. Relayer and sponsor are two separate accounts, each holding at most 2 NEAR.

## Security and no-leak rules

Each leak path below has one rule and one place it's enforced; contract-level checks live in the [contract design](https://claude.ai/artifact/UZt7ZbV8geuSEGjeHfoshD). Every rule in this table gets a test or a manual check on 14 Nov before submitting.

| Leak path | Rule | Enforced in |
| --- | --- | --- |
| Secrets in the repo | `.env*` in `.gitignore`, `gitleaks` in a pre-commit hook and CI, `.env.example` with names only | repo, CI |
| Secrets in the browser | only `NEXT_PUBLIC_CONTRACT_ID` and `NEXT_PUBLIC_NETWORK` are public; 1Click JWT and all keys stay in API routes | build config |
| Invite key leaking | key only in the URL `#`, removed from the address bar on load, `Referrer-Policy: no-referrer`, no analytics on `/i` | `/i` page, headers |
| Invoice file read by the wrong person | role checked against the contract on every request, not cached; old holder loses access on sale | file API |
| Invoice file tampered | re-hash after decrypt, must equal onchain `doc_hash` | file API, client re-check |
| Login replay | nonce single use, 5 min expiry, NEP-413 `recipient` must be our app, public key must be an access key on that account | auth API |
| Session theft | httpOnly, Secure, SameSite=Lax cookie, 12 h expiry, strict CSP, no `dangerouslySetInnerHTML` | middleware |
| Invite front-running | accept signature covers `(invoice_id, predecessor)`, so a copied signature is useless to anyone else | contract |
| Double payment | one open quote per invoice (DB unique index) and EXACT\_OUTPUT quotes | pay API |
| Fake "paid" | UI trusts only the contract's `paid`, never 1Click status or the DB | status API, UI |
| Sponsor drained | one drip per invoice, only to accounts under 0.01 NEAR, needs a valid invite token, account capped at 2 NEAR | sponsor API |
| API abuse | per-IP rate limits on quote, challenge and sponsor routes; zod validation on every body | middleware |
| Data in logs | no request bodies logged, invoice IDs and accounts only, errors scrubbed before Sentry (if used) | logger |
| Money math errors | amounts as strings and `bigint` end to end, USDC 6 decimals, no floats anywhere | shared `money.ts` |

Public by design and stated in the README: account IDs, amounts, due dates and status are onchain. Invoice IDs are sequential, so anyone can read those public fields for any invoice.

## Design system

The invoice is the hero: every key screen shows it as a real paper sheet, and status is an ink stamp pressed onto it. That stamp is the one bold, memorable element; everything else stays quiet, like good accounting software.

**Colour**

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `paper` | #F6F7F5 | #141820 | page background |
| `sheet` | #FFFFFF | #1B202A | invoice sheet, panels |
| `ink` | #18212E | #E6E9EE | text, Issued stamp |
| `rule` | #D5DAE0 | #2C3340 | lines, borders |
| `stamp-blue` | #3740B8 | #8C93F2 | Accepted, Partially paid, primary buttons |
| `stamp-green` | #1E7A4C | #5CC892 | Paid |
| `stamp-red` | #B3263A | #F07A8A | Rejected, errors |
| `amber` | #A86400 | #F0B04D | Overdue, warnings |

Cancelled uses `ink` at 50% with the amount struck through. Every pair is checked for 4.5:1 contrast.

**Type:** one family, Public Sans (Google Fonts), chosen because it reads like a plain official document and has tabular figures. Scale 13 / 15 / 18 / 24 / 36. Amounts always use `font-variant-numeric: tabular-nums` and sit right-aligned so columns of money line up. Sentence case everywhere, no all-caps labels.

**Layout:** left-aligned, one column. The invoice sheet is max 720 px wide with a thin top band for the issuer name; lists are ledger rows separated by rules, not cards. Mobile first, since many issuers and payers will be on phones.

```
/app/invoice/42                         /pay/42
+-------------------------------+       +-------------------------+
| Ada Okafor Studio             |       | Pay Ada Okafor Studio   |
| Invoice 42      Due 30 Nov    |       | 1,200.00 USDC due 30 Nov|
|-------------------------------|       |-------------------------|
| Brand design         800.00   |       | Pay with  [USDC] [Base] |
| Landing page         400.00   |       | Refund to [0x...      ] |
|-------------------------------|       | [Get payment address]   |
| Total          1,200.00 USDC  |       |                         |
|            ( ACCEPTED )  <- stamp     | 1 Send  2 Swap  3 Paid  |
+-------------------------------+       +-------------------------+
[Sell this invoice]  [Copy pay link]
```

**Components:** `InvoiceSheet`, `Stamp` (SVG, slightly rotated, ink texture), `StatusPill` (stamp colours, for lists), `Amount`, `LedgerRow`, `ChainTokenPicker`, `DepositPanel` (address, QR, copy, countdown), `PaymentSteps` (numbered, since it is a real sequence), `RecordLine` (client history in words: "12 paid on time, 1 late"), `ConfirmSheet` (states the exact action in plain words before the wallet opens), `Toast`. Built on shadcn/ui primitives, restyled to these tokens; `lucide-react` icons; `qrcode` for QR.

**Motion:** one moment only. When an invoice changes status, the new stamp presses onto the sheet (scale 1.15 to 1, 180 ms). Turned off under `prefers-reduced-motion`.

**Words:** an action keeps its name through the flow: "Accept invoice" button, "Invoice accepted" toast, "Accepted" stamp. Errors say what happened and what to do: "Quote expired. Get a new payment address." No wallet jargon on payer screens.

## Contract changes

The invite link means the client's account is unknown at mint and bound on accept. Five changes to the [contract design](https://claude.ai/artifact/UZt7ZbV8geuSEGjeHfoshD):

1. `Invoice.client` becomes `Option<AccountId>`; add `invite_pk` (ed25519 public key). `create_invoice` takes `invite_pk` instead of `client` (an optional known `client` can still be passed).
2. `accept_invoice(id, invite_sig)`: the contract rebuilds the message `(contract_id, invoice_id, predecessor, "accept")`, checks it with `env::ed25519_verify` against `invite_pk`, checks the caller isn't the issuer, then sets `client = predecessor`. Including the contract ID, action and caller means a signature can't be replayed on another contract, for another action or by another account.
3. `reject_invoice(id, reason_hash, invite_sig)`: same check with `"reject"`.
4. New `rotate_invite(id, new_pk)`: issuer only, while Issued. The old link stops working.
5. Mint also calls `storage_deposit` on the payment token for the issuer if they aren't registered, paid from the mint deposit, so the first payout doesn't fall back to claimable.

An Issued invoice paid in full still goes to Paid, but the client stays unbound, so no client reputation is recorded for it.

## Build schedule

Five days, contract first, submission by 18:00 UTC on 14 Nov to leave six hours of buffer before the 23:59 UTC deadline. If a day slips, cut from the list at the bottom, never from security or the README.

**Tue 10 Nov: contract core and the Intents test**

- [ ] Contract: create, accept and reject with invite signature, cancel, rotate invite, pay through `ft_on_transfer`, payout with claimable fallback
- [ ] Unit tests for every role check and the spoofed `ft_on_transfer` case
- [ ] Deploy to a mainnet dev account, register it on USDC, run the 1 USDC 1Click test with `customRecipientMsg`

**Wed 11 Nov: contract complete, backend skeleton**

- [ ] Contract: listing and buy, transfer guards, reputation, NEP-297 events; sandbox tests with `near-sandbox` + `near-api` (decided 10 Nov: `cargo near new` now scaffolds these rather than `near-workspaces`, so we follow the maintained path)
- [ ] Next.js app, Postgres schema, auth challenge and verify, drafts and file APIs with encryption, relay API

**Thu 12 Nov: issuer and client**

- [ ] `/app/new` with live preview, mint, invite link screen
- [ ] `/i/[id]` review, accept and reject
- [ ] `/app` dashboard and `/app/invoice/[id]` with the stamp

**Fri 13 Nov: payments and market**

- [ ] `/pay/[id]`, quote and status APIs, one-quote lock
- [ ] `/market`, `/market/[id]`, buy flow
- [ ] Mainnet deploy, full run: issue, accept, pay from Base, sell, second payment reaches buyer

**Sat 14 Nov: harden and ship**

- [ ] Walk the security table, run gitleaks, check headers
- [ ] README for the AI screeners: what it is, do X and see Y steps, contract address, what is public, what is pre-hackathon
- [ ] Record the demo (under 2 min, one real cross-chain payment), post on X with @NEARProtocol and #NEARHackathon
- [ ] Submit with tracks `realworld`, `nfts`, `defi`

**Cut if behind, in this order:** sponsor top-up, `/u/[account]` page, rotate invite, dark mode, native NEAR pay button.

## README and submission

The README is written for the Claude Code and Codex screeners first and the judges second: every claim points to code, a check and a step to try. The shape follows the strongest entries in this hackathon.

- [ ] Opening: the problem in one line, Ileri in one line, and the NEAR pieces used (Intents 1Click, NEP-171, NEP-366 meta transactions, NEAR Connect)
- [ ] "Try it" table: numbered Do and See steps, about 10 minutes, a testnet path that needs no keys, plus the hosted mainnet demo
- [ ] Fit-to-track table for `realworld`, `nfts` and `defi`: what the track asks, what Ileri does, the code path, how it is checked, what to try
- [ ] "What is real and what is not": amounts and accounts are public onchain; the server sees invoice plaintext while serving it; `customRecipientMsg` is experimental in 1Click; the relayer and sponsor accounts are ours; mainnet demo uses tiny amounts; no fiat offramp
- [ ] Tests run with one command and the README lists what they cover, including the spoofed `ft_on_transfer` case
- [ ] Built at NEAR HACKATHON block: code written from 2026-10-19, tags `pre-hackathon` and `hackathon-submission` with the compare link, AI assistance disclosed, libraries in LIBRARIES.md, MIT LICENSE, second project named if there is one
- [ ] Contract addresses (testnet and mainnet) and a hosted demo kept live until at least 18 Nov
- [ ] Demo video under 2 minutes showing one real cross-chain payment; the X post leads with the problem, not the tech

## Open questions

**Decided on 10 Nov:** building solo; payer options are USDC on Base, Arbitrum, Ethereum and Solana plus USDT on Tron (check each against 1Click's token list on day 1); gasless through our own relayer is in the plan; Postgres on Neon; register for a 1Click partner JWT today; product name is Ileri.

- [ ] Secure the Ileri domain, X handle and ileri.near account
- [ ] Confirm which NEAR Connect wallets return signed delegates in practice (test HOT and Meteor on day 2)
