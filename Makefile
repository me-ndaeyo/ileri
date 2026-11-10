# Ileri. Root task runner spanning the Rust contract and (from step 4) the Next.js app.
.DEFAULT_GOAL := help
.PHONY: help setup contract abi test fmt lint clean dev deploy-testnet gate

help:
	@printf 'Ileri targets:\n'
	@printf '  make setup           install the Rust toolchain (rustup, wasm, cargo-near, near)\n'
	@printf '  make gate            check the Rust toolchain is installed\n'
	@printf '  make contract        build the contract wasm with cargo-near\n'
	@printf '  make abi             generate the contract ABI json\n'
	@printf '  make test            contract tests (app tests added at step 4)\n'
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

test: gate
	cd contract && cargo test

fmt:
	cd contract && cargo fmt --all

lint:
	cd contract && cargo clippy --all-targets -- -D warnings

clean:
	cd contract && cargo clean

dev:
	@echo "app/ arrives at build step 5"

# Interactive on purpose. Choose testnet. Never mainnet without asking first.
deploy-testnet: contract
	@echo "Interactive deploy. Select testnet. Never mainnet."
	cd contract && cargo near deploy
