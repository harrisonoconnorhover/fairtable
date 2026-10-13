#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"

for command in cargo pnpm wasm-bindgen; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing $command. Install Rust 1.95.0, Node 24+, pnpm, and wasm-bindgen-cli 0.2.108." >&2
    echo "For the WASM CLI: cargo install wasm-bindgen-cli --version 0.2.108 --locked" >&2
    exit 1
  fi
done
if [[ "$(wasm-bindgen --version)" != "wasm-bindgen 0.2.108" ]]; then
  echo "Fairtable requires wasm-bindgen-cli 0.2.108 to match its Rust dependency." >&2
  exit 1
fi
pnpm install --frozen-lockfile
pnpm run build
node scripts/generate-notices.mjs
cargo build --release --locked -p fairtable-server
exec target/release/fairtable-server
