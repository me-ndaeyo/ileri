# Ileri. Root task runner spanning the Rust contract and (from step 4) the Next.js app.
.DEFAULT_GOAL := help
.PHONY: help setup contract abi test test-unit test-sandbox app-test fmt lint clean dev deploy-testnet walkthrough gate

help:
	@printf 'Ileri targets:\n'
	@printf '  make setup           install the Rust toolchain (rustup, wasm, cargo-near, near)\n'
	@printf '  make gate            check the Rust toolchain is installed\n'
	@printf '  make contract        build the contract wasm with cargo-near\n'
	@printf '  make abi             generate the contract ABI json\n'
	@printf '  make test            all contract tests: unit + sandbox\n'
	@printf '  make test-unit       unit tests only, for a fast loop\n'
	@printf '  make test-sandbox    end-to-end tests against a real NEAR node\n'
	@printf '  make fmt             format Rust sources\n'
	@printf '  make lint            clippy with warnings as errors\n'
	@printf '  make clean           remove build artifacts\n'
	@printf '  make deploy-testnet  deploy contract + test token to testnet, idempotent\n'
	@printf '  make walkthrough     issue, accept, pay, sell against the deployed contract\n'
	@printf '  make dev             run the app locally on :3000\n'
	@printf '  make app-test        app unit tests, lint and typecheck\n'

setup:
	./scripts/setup-toolchain.sh

gate:
	@command -v cargo >/dev/null 2>&1 || { echo "cargo missing. See the plan: Packages step 1."; exit 1; }
	@cargo near --version >/dev/null 2>&1 || { echo "cargo-near missing. See the plan: Packages step 1."; exit 1; }
	@rustup target list --installed | grep -q wasm32-unknown-unknown || { echo "run: rustup target add wasm32-unknown-unknown"; exit 1; }
	@echo "toolchain ok"

contract: gate
	cd contract && cargo near build non-reproducible-wasm

abi: gate
	cd contract && cargo near abi

# CLAUDE.md asks `make test` to run everything. App tests are appended at step 4.
test: gate
	cd contract && cargo test
	cd app && pnpm test

# The fast loop: no node to start, no wasm to build.
test-unit: gate
	cd contract && cargo test --lib

# Starts a real NEAR node and deploys both the contract and a test token.
# Downloads the sandbox binary on first run.
test-sandbox: gate
	cd contract && cargo test --test sandbox

fmt:
	cd contract && cargo fmt --all
	cd test-token && cargo fmt --all

# The test token is linted against the wasm target: near-sdk refuses a host build
# without the unit-testing feature, which that crate has no reason to enable.
lint:
	cd contract && cargo clippy --all-targets -- -D warnings
	cd test-token && cargo clippy --target wasm32-unknown-unknown -- -D warnings

clean:
	cd contract && cargo clean
	cd test-token && cargo clean

dev:
	cd app && pnpm dev

# Testnet only, and idempotent. Mainnet is deliberately not scripted: those commands
# are run by hand so each one is a deliberate decision.
deploy-testnet:
	./scripts/deploy-testnet.sh

# The whole journey against the deployed contract, asserting at every step. Run this
# before spending anything real.
walkthrough:
	./scripts/walkthrough-testnet.sh

app-test:
	cd app && pnpm test && pnpm lint && pnpm typecheck
