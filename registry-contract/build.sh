#!/bin/bash
set -e

# Build NEAR contract with WASM MVP compatibility
TOOLCHAIN="nightly-2025-01-07"
MANIFEST="$(dirname "$0")/Cargo.toml"
OUT_DIR="$(dirname "$0")/target/near"

echo "Building registry contract with $TOOLCHAIN..."

export PATH="$HOME/.rustup/toolchains/${TOOLCHAIN}-aarch64-apple-darwin/bin:$HOME/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

RUSTFLAGS='-C link-arg=-s -C target-cpu=mvp -C target-feature=-bulk-memory,-sign-ext,-multivalue,-reference-types' \
  cargo build \
    --target wasm32-unknown-unknown \
    --release \
    -Z build-std=std,panic_abort \
    -Z build-std-features=panic_immediate_abort \
    --manifest-path "$MANIFEST"

mkdir -p "$OUT_DIR"

WASM_IN="$(dirname "$0")/target/wasm32-unknown-unknown/release/registry_contract.wasm"
WASM_OUT="$OUT_DIR/registry_contract.wasm"

if command -v wasm-opt &> /dev/null; then
  echo "Optimizing with wasm-opt..."
  wasm-opt -Oz --enable-sign-ext --enable-bulk-memory --enable-mutable-globals --signext-lowering "$WASM_IN" -o "$WASM_OUT"
else
  echo "wasm-opt not found, copying unoptimized binary"
  cp "$WASM_IN" "$WASM_OUT"
fi

if command -v wasm-tools &> /dev/null; then
  echo "Validating WASM (MVP + mutable-global)..."
  wasm-tools validate --features=mvp,mutable-global "$WASM_OUT"
  echo "Validation passed!"
fi

echo ""
echo "Built: $WASM_OUT ($(du -h "$WASM_OUT" | cut -f1))"
