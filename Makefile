# Ileri. Root task runner spanning the Rust contract and (from step 4) the Next.js app.
.DEFAULT_GOAL := help
.PHONY: help setup contract abi test test-unit test-sandbox fmt lint clean dev deploy-testnet gate

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
	@printf '  make deploy-testnet  interactive deploy, testnet only\n'

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
	@echo "app/ arrives at build step 5"

# Interactive on purpose. Choose testnet. Never mainnet without asking first.
deploy-testnet: contract
	@echo "Interactive deploy. Select testnet. Never mainnet."
	cd contract && cargo near deploy
