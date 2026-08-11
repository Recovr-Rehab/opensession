#!/bin/sh
# Rebuild the legacy fallback rasters for OS1Meridian on the standard macOS
# icon grid: the squircle must occupy 824/1024 of the canvas with transparent
# margins, or the Dock draws it oversized next to other apps. Renders each
# slot's raw SVG artwork with sips, adds a soft alpha-following shadow while
# padding it with pad.swift, packs an icns, and also emits icon-512.png (used by
# the dev shell's app.dock.setIcon and the web launch mark).
set -e
cd "$(dirname "$0")"
DEV_DIR=${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}
SVG="OS1Meridian.icon/Assets/meridian.svg"

iconset="fallback-os1-meridian.iconset"
rm -rf "$iconset" && mkdir -p "$iconset"
for s in 16 32 64 128 256 512 1024; do
  art=$(( (s * 824 + 512) / 1024 ))
  sips -s format png -z "$art" "$art" "$SVG" \
    --out "$iconset/tmp-art-$s.png" >/dev/null
  DEVELOPER_DIR="$DEV_DIR" xcrun swift pad.swift "$iconset/tmp-art-$s.png" "$iconset/tmp-$s.png" "$s" "$art"
done
cp "$iconset/tmp-16.png"   "$iconset/icon_16x16.png"
cp "$iconset/tmp-32.png"   "$iconset/icon_16x16@2x.png"
cp "$iconset/tmp-32.png"   "$iconset/icon_32x32.png"
cp "$iconset/tmp-64.png"   "$iconset/icon_32x32@2x.png"
cp "$iconset/tmp-128.png"  "$iconset/icon_128x128.png"
cp "$iconset/tmp-256.png"  "$iconset/icon_128x128@2x.png"
cp "$iconset/tmp-256.png"  "$iconset/icon_256x256.png"
cp "$iconset/tmp-512.png"  "$iconset/icon_256x256@2x.png"
cp "$iconset/tmp-512.png"  "$iconset/icon_512x512.png"
cp "$iconset/tmp-1024.png" "$iconset/icon_512x512@2x.png"
cp "$iconset/tmp-512.png"  icon-512-padded.png
rm "$iconset"/tmp-*.png
iconutil -c icns "$iconset" -o os1-meridian.icns
echo "wrote os1-meridian.icns + icon-512-padded.png"
