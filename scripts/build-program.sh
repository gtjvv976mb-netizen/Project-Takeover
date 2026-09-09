#!/usr/bin/env bash
# Build the escrow program and regenerate its IDL.
#
# Pinned to the 4.2.2 toolchain on purpose: `anchor idl build` silently flips
# ~/.local/share/solana/install/active_release back to the Solana version Anchor 0.31.1
# recommends (2.1.0), whose Rust is too old to parse edition2024 dependencies. Always
# call the versioned binary rather than whatever active_release points at today.
set -euo pipefail
cd "$(dirname "$0")/.."

SBF="$HOME/.local/share/solana/install/releases/4.2.2/solana-release/bin/cargo-build-sbf"
export PATH="$HOME/.local/share/solana/install/releases/4.2.2/solana-release/bin:$HOME/.cargo/bin:$PATH"

[ -x "$SBF" ] || { echo "Missing $SBF — run: sh -c \"\$(curl -sSfL https://release.anza.xyz/v4.2.2/install)\"" >&2; exit 1; }

echo "==> building program"
"$SBF" --manifest-path programs/takeover-escrow/Cargo.toml --sbf-out-dir target/deploy

echo "==> generating IDL"
mkdir -p target/idl target/types
anchor idl build -o target/idl/takeover_escrow.json -t target/types/takeover_escrow.ts

echo "==> done"
ls -la target/deploy/*.so target/idl/*.json

echo "==> syncing the IDL the app builds against"
cp target/idl/takeover_escrow.json src/idl/takeover_escrow.json
