#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ASTRA Contract Deployment Script
# Usage: STELLAR_SECRET=S... ./contract/deploy.sh [--network testnet|mainnet]
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
WASM_DIR="$(dirname "$0")/target/wasm32v1-none/release"
HELLO_WORLD_WASM="$WASM_DIR/hello_world.wasm"
ESCROW_WASM="$WASM_DIR/escrow.wasm"

# ── Validation ───────────────────────────────────────────────────────────────
if [ -z "${STELLAR_SECRET:-}" ]; then
  echo "❌  Error: STELLAR_SECRET environment variable is not set."
  echo "   Export your Stellar secret key before running:"
  echo "   export STELLAR_SECRET=S..."
  exit 1
fi

if ! command -v stellar &> /dev/null; then
  echo "❌  Error: Stellar CLI not found."
  echo "   Install it from: https://github.com/stellar/stellar-cli"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ASTRA — Smart Contract Deployment"
echo "  Network: $NETWORK"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# ── Step 1: Build contracts ──────────────────────────────────────────────────
echo ""
echo "📦  Building WASM artifacts..."
cargo build --release --target wasm32v1-none \
  --manifest-path "$(dirname "$0")/Cargo.toml" \
  -p hello-world -p escrow

echo "✅  Build complete."

# ── Step 2: Deploy hello-world ───────────────────────────────────────────────
echo ""
echo "🚀  Deploying hello-world contract to $NETWORK..."
HELLO_WORLD_ID=$(stellar contract deploy \
  --wasm "$HELLO_WORLD_WASM" \
  --source "$STELLAR_SECRET" \
  --network "$NETWORK" \
  --alias hello-world 2>&1 | tee /dev/stderr | tail -1)

echo ""
echo "✅  hello-world deployed!"
echo "   Contract ID: $HELLO_WORLD_ID"

# ── Step 3: Deploy escrow ─────────────────────────────────────────────────────
echo ""
echo "🚀  Deploying escrow contract to $NETWORK..."
ESCROW_ID=$(stellar contract deploy \
  --wasm "$ESCROW_WASM" \
  --source "$STELLAR_SECRET" \
  --network "$NETWORK" \
  --alias escrow 2>&1 | tee /dev/stderr | tail -1)

echo ""
echo "✅  escrow deployed!"
echo "   Contract ID: $ESCROW_ID"

# ── Step 4: Output summary ───────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Deployment Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  hello-world : $HELLO_WORLD_ID"
echo "  escrow      : $ESCROW_ID"
echo ""
echo "  📝  Next steps:"
echo "  1. Open src/main.js"
echo "  2. Update CONTRACT_ID = '$HELLO_WORLD_ID'"
echo "  3. Update ESCROW_CONTRACT_ID = '$ESCROW_ID'"
echo "  4. Run: npm run build"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
