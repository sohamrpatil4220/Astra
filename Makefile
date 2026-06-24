# ASTRA — Root Makefile
# Convenience targets for development and deployment

.PHONY: help dev build test-contracts build-contracts lint-contracts \
        deploy-hello-world deploy-escrow clean install

# ─────────────────────────────────────────────────────────────────────────────
# Default: show help
# ─────────────────────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  ASTRA — Stellar Testnet Wallet Dashboard"
	@echo "  ─────────────────────────────────────────"
	@echo ""
	@echo "  Frontend:"
	@echo "    make install           Install Node.js dependencies"
	@echo "    make dev               Start Vite development server"
	@echo "    make build             Build production frontend bundle"
	@echo "    make test-frontend     Run Vitest frontend tests"
	@echo ""
	@echo "  Contracts:"
	@echo "    make build-contracts   Compile both contracts to WASM (release)"
	@echo "    make test-contracts    Run all Soroban Rust unit tests"
	@echo "    make lint-contracts    Run cargo clippy + fmt check"
	@echo ""
	@echo "  Deployment:"
	@echo "    make deploy-hello-world  Deploy hello-world contract to testnet"
	@echo "    make deploy-escrow       Deploy escrow contract to testnet"
	@echo ""
	@echo "  Utilities:"
	@echo "    make clean             Remove build artifacts"
	@echo ""
	@echo "  Required env vars for deployment:"
	@echo "    STELLAR_SECRET         Stellar secret key (starts with S...)"
	@echo "    HELLO_WORLD_CONTRACT   Contract ID for escrow deployment"
	@echo ""

# ─────────────────────────────────────────────────────────────────────────────
# Frontend
# ─────────────────────────────────────────────────────────────────────────────
install:
	npm install

dev:
	npm run dev

build:
	npm run build

test-frontend:
	npm test

# ─────────────────────────────────────────────────────────────────────────────
# Smart Contracts
# ─────────────────────────────────────────────────────────────────────────────
build-contracts:
	@echo "Building hello-world WASM..."
	cd contract && cargo build --release --target wasm32-unknown-unknown -p hello-world
	@echo "Building escrow WASM..."
	cd contract && cargo build --release --target wasm32-unknown-unknown -p escrow
	@echo ""
	@echo "Build complete. WASMs:"
	@ls -lh contract/target/wasm32-unknown-unknown/release/*.wasm 2>/dev/null || echo "  (no WASM files found)"

test-contracts:
	@echo "Running Soroban unit tests..."
	cd contract && cargo test --all
	@echo ""
	@echo "All tests passed!"

lint-contracts:
	@echo "Running clippy..."
	cd contract && cargo clippy --all-targets -- -D warnings
	@echo "Checking formatting..."
	cd contract && cargo fmt --all -- --check
	@echo "Lint checks passed!"

# ─────────────────────────────────────────────────────────────────────────────
# Deployment (requires Stellar CLI installed)
# ─────────────────────────────────────────────────────────────────────────────
deploy-hello-world: build-contracts
	@if [ -z "$(STELLAR_SECRET)" ]; then \
		echo "Error: STELLAR_SECRET environment variable is not set."; \
		echo "  Usage: STELLAR_SECRET=S... make deploy-hello-world"; \
		exit 1; \
	fi
	@echo "Deploying hello-world contract to testnet..."
	stellar contract deploy \
		--wasm contract/target/wasm32-unknown-unknown/release/hello_world.wasm \
		--source "$(STELLAR_SECRET)" \
		--network testnet \
		--alias hello-world
	@echo "Deployment complete! Update CONTRACT_ID in src/main.js"

deploy-escrow: build-contracts
	@if [ -z "$(STELLAR_SECRET)" ]; then \
		echo "Error: STELLAR_SECRET environment variable is not set."; \
		exit 1; \
	fi
	@if [ -z "$(HELLO_WORLD_CONTRACT)" ]; then \
		echo "Error: HELLO_WORLD_CONTRACT environment variable is not set."; \
		echo "  Run 'make deploy-hello-world' first."; \
		exit 1; \
	fi
	@echo "Deploying escrow contract to testnet..."
	stellar contract deploy \
		--wasm contract/target/wasm32-unknown-unknown/release/escrow.wasm \
		--source "$(STELLAR_SECRET)" \
		--network testnet \
		--alias escrow
	@echo "Deployment complete!"

# ─────────────────────────────────────────────────────────────────────────────
# Utilities
# ─────────────────────────────────────────────────────────────────────────────
clean:
	@echo "Cleaning build artifacts..."
	cd contract && cargo clean
	rm -rf dist
	@echo "Clean complete!"
