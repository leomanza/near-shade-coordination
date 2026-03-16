#!/bin/bash
# Build both NEAR contracts with nightly Rust targeting WASM MVP
# Required to avoid bulk-memory/sign-ext instructions that NEAR testnet rejects

set -e

NIGHTLY="nightly-2025-01-07-aarch64-apple-darwin"
NPATH="$HOME/.rustup/toolchains/$NIGHTLY/bin"
CARGO="$NPATH/cargo"
RUSTC="$NPATH/rustc"

export RUSTFLAGS='-C link-arg=-s -C target-cpu=mvp -C target-feature=-bulk-memory,-sign-ext,-multivalue,-reference-types'
export RUSTC="$RUSTC"

ROOT="$(cd "$(dirname "$0")" && pwd)"

build_contract() {
  local name="$1"
  local dir="$2"
  echo ""
  echo "=== Building $name ==="
  "$CARGO" build \
    --manifest-path "$dir/Cargo.toml" \
    --target wasm32-unknown-unknown \
    --release \
    -Z build-std=std,panic_abort \
    -Z build-std-features=panic_immediate_abort
  echo "=== $name build complete ==="
}

optimize_wasm() {
  local name="$1"
  local input="$2"
  local output="$3"
  echo ""
  echo "=== Optimizing $name WASM ==="
  # --signext-lowering lowers sign-ext ops to MVP equivalents
  # --mvp-features disables all non-MVP features in the output
  wasm-opt -Oz --signext-lowering --mvp-features "$input" -o "$output"
  wasm-tools validate --features=mvp,mutable-global "$output"
  echo "=== $name optimized: $output ($( wc -c < "$output" ) bytes) ==="
}

if [ "${BUILD_REGISTRY:-1}" = "1" ]; then
  build_contract "registry-contract" "$ROOT/registry-contract"
  mkdir -p "$ROOT/registry-contract/target/near"
  optimize_wasm "registry" \
    "$ROOT/registry-contract/target/wasm32-unknown-unknown/release/registry_contract.wasm" \
    "$ROOT/registry-contract/target/near/registry_contract.wasm"
fi

if [ "${BUILD_COORDINATOR:-1}" = "1" ]; then
  build_contract "coordinator-contract" "$ROOT/coordinator-contract"
  mkdir -p "$ROOT/coordinator-contract/target/near"
  optimize_wasm "coordinator" \
    "$ROOT/coordinator-contract/target/wasm32-unknown-unknown/release/coordinator_contract.wasm" \
    "$ROOT/coordinator-contract/target/near/coordinator_contract.wasm"
fi

if [ "${BUILD_FACTORY:-1}" = "1" ]; then
  # Factory embeds coordinator WASM — build coordinator first (BUILD_COORDINATOR=1)
  build_contract "factory-contract" "$ROOT/factory-contract"
  mkdir -p "$ROOT/factory-contract/target/near"
  optimize_wasm "factory" \
    "$ROOT/factory-contract/target/wasm32-unknown-unknown/release/coordinator_factory.wasm" \
    "$ROOT/factory-contract/target/near/coordinator_factory.wasm"
fi

echo ""
echo "All contracts built successfully!"
