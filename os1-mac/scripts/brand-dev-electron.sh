#!/bin/sh
# Dev runs (`electron .`) execute the stock Electron.app from node_modules, so
# the Dock/menu-bar label says "Electron". Rebrand that local bundle to
# Open Session. PlistBuddy takes the rest of the command as the value, so the
# space in the name needs no extra quoting.
# Electron reinstalls reset it — wired as postinstall. Ad-hoc re-sign afterwards
# because editing Info.plist invalidates the existing signature.
set -e
cd "$(dirname "$0")/.."
APP=node_modules/electron/dist/Electron.app
[ -d "$APP" ] || exit 0
for key in CFBundleName CFBundleDisplayName; do
  /usr/libexec/PlistBuddy -c "Set :$key Open Session" "$APP/Contents/Info.plist" 2>/dev/null ||
    /usr/libexec/PlistBuddy -c "Add :$key string Open Session" "$APP/Contents/Info.plist"
done
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
touch "$APP"
echo "branded $APP as Open Session"
