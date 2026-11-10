#!/usr/bin/env bash
# Ileri: install the Rust toolchain needed to build the NEAR contract.
# Idempotent — safe to re-run. Installs nothing that is already present.
set -euo pipefail

say() { printf '\n==> %s\n' "$1"; }

# 1. rustup, which provides rustc and cargo. Everything else depends on this.
if command -v rustup >/dev/null 2>&1; then
  say "rustup already installed ($(rustup --version 2>/dev/null | head -1))"
else
  say "Installing rustup (this downloads ~300MB, give it a few minutes)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
fi

# 2. Put cargo on PATH for the rest of THIS script.
#    --no-modify-path above means we add the profile line ourselves, once.
# shellcheck disable=SC1091
[ -s "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

for profile in "$HOME/.zshrc" "$HOME/.zprofile"; do
  [ -f "$profile" ] || continue
  if ! grep -q '.cargo/env' "$profile" 2>/dev/null; then
    say "Adding cargo to PATH in $profile"
    printf '\n# Rust (added by ileri/scripts/setup-toolchain.sh)\n. "$HOME/.cargo/env"\n' >> "$profile"
  fi
done

# 3. The wasm target. NEAR contracts compile to wasm32-unknown-unknown.
if rustup target list --installed | grep -q wasm32-unknown-unknown; then
  say "wasm32-unknown-unknown already installed"
else
  say "Adding the wasm32-unknown-unknown target"
  rustup target add wasm32-unknown-unknown
fi

# 4. cargo-near: builds the contract wasm and generates the ABI.
#    A cargo subcommand, so it is useless before step 1.
if cargo near --version >/dev/null 2>&1; then
  say "cargo-near already installed ($(cargo near --version 2>&1 | head -1))"
else
  say "Installing cargo-near"
  curl --proto '=https' --tlsv1.2 -LsSf \
    https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh
fi

# 5. near-cli-rs: deploys and calls the contract. Standalone, order-independent.
if command -v near >/dev/null 2>&1; then
  say "near CLI already installed ($(near --version 2>&1 | head -1))"
else
  say "Installing near-cli-rs"
  curl --proto '=https' --tlsv1.2 -LsSf \
    https://github.com/near/near-cli-rs/releases/latest/download/near-cli-rs-installer.sh | sh
fi

say "Versions"
rustc --version
cargo --version
cargo near --version 2>&1 | head -1
near --version 2>&1 | head -1
rustup target list --installed | grep wasm32-unknown-unknown

say "Done. Open a new terminal (or run: source \"\$HOME/.cargo/env\"), then: make gate"
