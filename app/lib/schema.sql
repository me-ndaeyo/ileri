-- Ileri's database.
--
-- Deliberately small. The contract owns money, status and ownership; this holds only
-- what cannot live on a public chain: encrypted invoice files, single-use nonces, and
-- payment quotes in flight. Losing all of it loses no money and no invoice state.
--
-- Applied by `pnpm db:migrate`, which is idempotent, so it is safe to re-run.

-- Single-use challenges for NEP-413 sign-in and for proving possession of an invite key.
create table if not exists auth_nonces (
  -- The 32 random bytes, hex encoded.
  nonce       text primary key,
  -- 'login' or 'invite'. A nonce issued for one must not be spendable on the other.
  purpose     text not null check (purpose in ('login', 'invite')),
  -- For 'invite', which invoice it is for. Null for 'login', where the account is not
  -- known until the signature arrives.
  subject     text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  -- Set the moment it is spent. The uniqueness of `nonce` plus this column is what makes
  -- a replayed signature useless.
  used_at     timestamptz
);

create index if not exists auth_nonces_expires_at on auth_nonces (expires_at);

-- Invoice files, encrypted at rest. The plaintext holds client names, line items and
-- notes, which must never reach the chain.
create table if not exists invoice_files (
  id            uuid primary key default gen_random_uuid(),
  -- Null until the mint succeeds and the draft is linked to a real invoice.
  invoice_id    text,
  issuer        text not null,
  -- AES-256-GCM. The row id is the associated data, so a ciphertext cannot be moved to
  -- another row and still decrypt.
  ciphertext    bytea not null,
  iv            bytea not null,
  auth_tag      bytea not null,
  -- Which FILE_ENC_KEY encrypted it, so the key can be rotated without rewriting rows.
  key_version   integer not null default 1,
  -- sha256 of the plaintext. Checked against the contract's doc_hash before serving, so
  -- a tampered row is refused rather than shown.
  doc_hash      bytea not null,
  created_at    timestamptz not null default now()
);

create index if not exists invoice_files_invoice_id on invoice_files (invoice_id);
create index if not exists invoice_files_issuer on invoice_files (issuer);

-- Open 1Click quotes. One per invoice at a time, so two payers cannot both send: the
-- excess from a double payment goes back to the Intents contract rather than the payer.
create table if not exists pay_quotes (
  deposit_address text primary key,
  invoice_id      text not null,
  origin_asset    text not null,
  amount_in       text not null,
  amount_out      text not null,
  status          text not null default 'open',
  deadline        timestamptz not null,
  created_at      timestamptz not null default now()
);

-- The lock. A partial unique index means only one row per invoice can be 'open', while
-- any number of expired or settled ones may remain for the record.
create unique index if not exists pay_quotes_one_open_per_invoice
  on pay_quotes (invoice_id) where status = 'open';

-- One NEAR top-up per invoice, so a new client can afford the mint storage deposit.
-- The primary key is the cap: a second drip for the same invoice cannot be inserted.
create table if not exists sponsor_drips (
  invoice_id  text primary key,
  account_id  text not null,
  tx_hash     text,
  created_at  timestamptz not null default now()
);
