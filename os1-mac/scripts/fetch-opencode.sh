#!/bin/sh
set -eu

VERSION=1.18.18
SHA512=5641be6f3f2ef17aa0f4dccf2bedbfef59c47780ca2a5a3634b66ead0d5e2c0cc39e66f508c61989ffe8e92865f1816e4ee614ff7d24eb2b9f97866bd088fae2
PACKAGE="opencode-darwin-arm64"
URL="https://registry.npmjs.org/$PACKAGE/-/$PACKAGE-$VERSION.tgz"
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEST="$ROOT/build/vendor/opencode"

if [ -x "$DEST" ] && "$DEST" --version 2>/dev/null | grep -q "$VERSION"; then
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl --fail --location --retry 3 --proto '=https' --proto-redir '=https' \
  --connect-timeout 15 --max-time 300 "$URL" --output "$TMP/opencode.tgz"
printf '%s  %s\n' "$SHA512" "$TMP/opencode.tgz" | shasum -a 512 -c -
tar -xzf "$TMP/opencode.tgz" -C "$TMP" package/bin/opencode
mkdir -p "$(dirname "$DEST")"
install -m 755 "$TMP/package/bin/opencode" "$DEST"
"$DEST" --version
