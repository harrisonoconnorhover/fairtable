#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$project_root"

if [[ $# -gt 1 || (${1:-} != "" && ${1:-} != "--built-assets") ]]; then
  echo "Usage: $0 [--built-assets]" >&2
  exit 2
fi
reuse_assets=false
if [[ ${1:-} == "--built-assets" ]]; then reuse_assets=true; fi

for command in cargo rustc node; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing $command. Install Rust 1.95.0, Node 24+, pnpm, and wasm-bindgen-cli 0.2.108." >&2
    echo "For the WASM CLI: cargo install wasm-bindgen-cli --version 0.2.108 --locked" >&2
    exit 1
  fi
done
if [[ "$reuse_assets" == false ]]; then
  for command in pnpm wasm-bindgen; do
    if ! command -v "$command" >/dev/null 2>&1; then
      echo "Missing $command. Install pnpm 11.25.0 and wasm-bindgen-cli 0.2.108." >&2
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
fi
for asset in index.html THIRD_PARTY_NOTICES.txt RUST_STD_NOTICES.html LICENSE.txt; do
  if [[ ! -f "dist/$asset" ]]; then
    echo "Missing dist/$asset. Build the frontend and run node scripts/generate-notices.mjs first." >&2
    exit 1
  fi
done
cargo build --release --locked -p fairtable-server

version=$(node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).version')
host=$(rustc -vV | sed -n 's/^host: //p')
release_name="fairtable-$version-$host"
output="$project_root/artifacts/releases"
staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
mkdir -p "$staging/$release_name" "$output"
cp target/release/fairtable-server "$staging/$release_name/fairtable"
cp LICENSE "$staging/$release_name/"
if [[ -f README.md ]]; then cp README.md "$staging/$release_name/"; fi
cp dist/THIRD_PARTY_NOTICES.txt dist/RUST_STD_NOTICES.html "$staging/$release_name/"
cat > "$staging/$release_name/RUNNING.txt" <<'EOF'
Run ./fairtable, then open http://127.0.0.1:7777.
The web interface and SQLite engine are included. No cloud account is required.

Optional environment variables:
FAIRTABLE_DATA=/absolute/path/fairtable.sqlite3
FAIRTABLE_HOST=127.0.0.1
FAIRTABLE_PORT=7777
FAIRTABLE_ORIGIN=https://tables.example.com

The personal edition has no login. Remote access requires your own
authenticated TLS reverse proxy. Keep its database directory persistent.
For a complete cold backup, stop Fairtable before copying the SQLite file.
Export workspace JSON from the application for a portable document backup.
EOF
tar -czf "$output/$release_name.tar.gz" -C "$staging" "$release_name"
(
  cd "$output"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$release_name.tar.gz" > "$release_name.tar.gz.sha256"
  else
    shasum -a 256 "$release_name.tar.gz" > "$release_name.tar.gz.sha256"
  fi
)
echo "Created $output/$release_name.tar.gz"
