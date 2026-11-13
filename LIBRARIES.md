# Libraries

Everything third-party Ileri depends on, why it is here, and what was decided against.
Versions are the ones in `contract/Cargo.toml` and `app/package.json`; those files are the
source of truth if this drifts.

## Contract, Rust

| Library | Version | Why |
| --- | --- | --- |
| `near-sdk` | 5.30.1 | The contract SDK. Latest stable. |
| `near-contract-standards` | 5.30.1 | NEP-171 core, NEP-177 metadata, NEP-181 enumeration, NEP-141 receiver traits. Tracks `near-sdk` exactly. |

**NEP-178 approvals are deliberately not implemented.** The marketplace lives inside this
contract, so there is no reason for a third party to be able to move an invoice. It is
disabled structurally rather than by a check: `NonFungibleToken::new` is given no approval
storage prefix, so the capability does not exist to be bypassed.

The `impl_non_fungible_token_core!` macros are deprecated upstream, so the NEP-171, NEP-177
and NEP-181 traits are written by hand in `contract/src/nft.rs`. Ileri needs that anyway,
because transfers are guarded by invoice state.

### Contract dev dependencies

| Library | Version | Why |
| --- | --- | --- |
| `near-sdk` (`unit-testing`) | 5.30.1 | `VMContextBuilder` and `testing_env!` for the unit tests. |
| `near-sandbox` | 0.4.0 | Runs a real NEAR node for the end-to-end tests. |
| `near-api` | 0.8 | Talks to that node from the tests. |
| `cargo-near-build` | 0.11 | Builds the wasm the sandbox tests deploy. |
| `ed25519-dalek` | 2.2 | Signs invite fixtures, from fixed seeds so tests never depend on randomness. |
| `testresult` | 0.4 | Test-only error type, so a sandbox test can use `?`. |
| `tokio` | 1 | The sandbox API is async. |

Both design docs say `near-workspaces`. That was wrong and the code does not use it: the
current path is `near-sandbox` plus `near-api`, which is what the toolchain supports today.

## App, TypeScript

| Library | Version | Why |
| --- | --- | --- |
| `next` | 16.4.6 | App Router, Cache Components and Partial Prerendering, which is what lets every page serve a static frame and stream only the part that depends on the request. |
| `react`, `react-dom` | 19.3.0 | Required by Next 16. |
| `typescript` | 5 | Strict. `next typegen` generates the typed route helpers. |
| `tailwindcss`, `@tailwindcss/turbopack` | 4.3.3 | CSS-first `@theme`, so the design tokens live in `app/app/globals.css` and nowhere else. |
| `@hot-labs/near-connect` | 0.12.0 | Wallet selector. Chosen because it does NEP-413 `signInAndSignMessage` in one round trip, which is how sign-in proves key ownership without a transaction. |
| `@noble/ed25519` | 3.2.0 | Signs the invite challenge in the browser. |
| `@noble/hashes` | 2.4.0 | sha256 for `doc_hash`, and HMAC for session and invite tokens. |
| `pg` | 8.23.1 | Postgres, against Neon's pooled endpoint. Holds drafts and encrypted invoice files, never money or status. |
| `zod` | 4.6.7 | Validates every request body and every environment variable at the boundary. |
| `vitest` | 5.1.0 | Tests. Split config: unit tests run offline, integration tests are opt-in because they need a database and the network. |
| `eslint`, `eslint-config-next` | 9, 16.4.6 | Lint. |

### Decided against

- **WebCrypto Ed25519** instead of `@noble/ed25519`. It only reached Chrome 137, so a
  client opening an invite link on a slightly older browser would silently fail to accept
  an invoice. Not acceptable for the one flow a non-crypto user has to complete.
- **A NEAR JS SDK for signing.** `near-connect` already owns the wallet connection, and a
  second signing path would be a second place for the NEP-413 payload to be built wrong.
  The payload is borsh-encoded by hand in `app/lib/nep413.ts`, which is 40 lines and
  tested, rather than pulling in a transaction library for one struct.
- **An ORM.** The schema is three tables and the queries are parameterised SQL. An ORM
  would add a dependency and a build step to express less.
- **shadcn/ui**, which the implementation plan named. The design is a paper document with
  square corners, hairline rules and one animation; shadcn's defaults are rounded cards
  and motion, so almost every component would have been fought rather than used. The
  components here are plain elements against the tokens in `globals.css`.
- **A charting library.** The only chart is a payment bar, which is a div.

## Not a library, but worth declaring

- **NEAR Intents 1Click**, a hosted API at `1click.chaindefuser.com`, used for paying from
  a chain other than NEAR. No SDK: it is three HTTP calls and `app/lib/oneclick.ts` makes
  them directly.
- **Neon**, hosted Postgres.
- **Google Fonts**: Instrument Serif, Public Sans, IBM Plex Mono, loaded through
  `next/font` so they are self-hosted at build time and no request leaves the user's
  browser to a third party.

## AI assistance

This project was built with Claude Code. It wrote most of the contract, the app and the
tests, under review, and the design was worked out on a canvas before any of it was
implemented. The decisions recorded in `docs/` and in the commit messages are the audit
trail: where a choice was made for a reason, the reason is written down next to it.
