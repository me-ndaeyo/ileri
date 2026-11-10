# Ileri

Ileri (Yoruba for "promise") lets a freelancer or small business issue an invoice as an NFT on NEAR, get paid by the client from any chain through NEAR Intents 1Click, and sell the invoice early to a buyer. Payments always go to whoever holds the invoice NFT.

Built for NEAR HACKATHON. Tracks: `realworld`, `nfts`, `defi`. Deadline: 2026-11-14 23:59 UTC. Target: submit by 18:00 UTC that day.

## Source of truth

Read these before any task. If they disagree, the implementation plan's "Contract changes" section wins over the contract design.

- `docs/contract-design.md`: data model, lifecycle, methods, payment routing, marketplace, security checklist
- `docs/implementation-plan.md`: architecture, roles and sign-in, journeys, screens and API, payment flow, storage, security rules, design system, schedule, README checklist

## Repo layout

```
contract/        Rust NEAR contract (near-sdk 5.x, near-contract-standards)
  src/lib.rs
  tests/         near-workspaces sandbox tests
app/             Next.js (App Router, TypeScript, Tailwind, shadcn/ui)
  app/           pages: /, /app, /app/new, /app/invoice/[id], /i/[id], /pay/[id], /market, /market/[id], /u/[account]
  app/api/       auth, drafts, invoices, invite, sponsor, relay, pay
  lib/           near.ts, money.ts, crypto.ts, oneclick.ts, db.ts, session.ts
scripts/         deploy and the 1Click payment test
docs/            the two design docs
```

## Commands

Fill these in as they are created, and keep them working:

- `make test`: contract unit + sandbox tests, then app tests
- `make contract`: build the contract wasm with cargo-near
- `make dev`: run the app locally
- `make deploy-testnet`: deploy to the testnet dev account

## Hard rules

- Never commit secrets. Keys live in `.env.local` (gitignored). `.env.example` holds names only.
- Never deploy to mainnet, sign mainnet transactions, spend tokens, push, force-push or make the repo public without asking me first.
- Money is always a string or `bigint`, never a float. USDC has 6 decimals. All money helpers live in `app/lib/money.ts`.
- The contract is the only source of truth for money and status. The UI shows "Paid" only when the contract's `paid` equals `amount`, never from 1Click status or the database alone.
- `ft_on_transfer` must reject any caller that is not an allowlisted token contract and any token that is not `invoice.token`. Write the spoofing test first.
- Checked math on every U128. Role checks use `predecessor_account_id()`.
- Invite private keys live only in the URL fragment and browser memory. Never log them, never send them to the server.
- The 1Click JWT, relayer key, sponsor key, session secret and file encryption key are server-only. Only `NEXT_PUBLIC_CONTRACT_ID` and `NEXT_PUBLIC_NETWORK` may reach the browser.
- Do not trust versions or API shapes from memory. Check the current docs for near-sdk, cargo-near, near-workspaces, `@hot-labs/near-connect` and the 1Click API before using them.

## How to work

- Contract first, tests first. Each contract method gets tests for the happy path, every role check and every rejected state before moving on.
- Small commits with clear messages. One feature per commit.
- After each step, run `make test` and tell me what passed and what is next.
- When something in the docs is ambiguous, ask instead of guessing.
- UI copy: sentence case, plain words, no em dashes, no all-caps labels. An action keeps one name through the flow ("Accept invoice", "Invoice accepted").

## Build order

1. Contract core: create (with invite key), accept and reject (with invite signature), cancel, rotate invite, pay via `ft_on_transfer`, payout with claimable fallback, views.
2. Contract complete: listing and buy, transfer guards, reputation, NEP-297 events, sandbox tests.
3. 1Click test on mainnet with about 1 USDC using `customRecipientMsg` (I run this step myself).
4. App backend: auth (NEP-413), drafts and encrypted file storage, invite, relay, sponsor, pay quote and status.
5. App pages: issuer and client flows, then pay page, then market.
6. README, LIBRARIES.md, demo, submission.
