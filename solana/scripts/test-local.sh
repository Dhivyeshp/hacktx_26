#!/usr/bin/env bash
# Runs the program tests on a throwaway solana-test-validator with the built
# program preloaded. (Anchor 1.x's `anchor test` wants surfpool; this doesn't.)
# Usage: npm run chain:test   (after npm run chain:build)
set -euo pipefail
cd "$(dirname "$0")/.."

PROGRAM_ID=$(grep -m1 'centerpiece =' Anchor.toml | sed -E 's/.*"(.*)"/\1/')
LEDGER=$(mktemp -d)
RPC=http://127.0.0.1:8899

solana-test-validator --reset --quiet --ledger "$LEDGER" \
  --gossip-port 18000 --dynamic-port-range 18001-18030 \
  --bpf-program "$PROGRAM_ID" target/deploy/centerpiece.so >"$LEDGER/out.log" 2>&1 &
VALIDATOR=$!
trap 'kill $VALIDATOR 2>/dev/null; rm -rf "$LEDGER"' EXIT

for _ in $(seq 1 40); do solana cluster-version --url $RPC >/dev/null 2>&1 && break; sleep 1; done
solana airdrop 50 --url $RPC >/dev/null

ANCHOR_PROVIDER_URL=$RPC ANCHOR_WALLET="${ANCHOR_WALLET:-$HOME/.config/solana/id.json}" \
  node --import tsx --test tests/centerpiece.test.ts
