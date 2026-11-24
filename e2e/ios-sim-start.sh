#!/usr/bin/env bash
# Starts an iPhone Simulator, installs the app, and puts the compendium in Files → On My iPhone,
# where a player would keep it.
set -euo pipefail
UDID=$(xcrun simctl list devices available -j | python3 -c "import json,sys; d=json.load(sys.stdin)['devices']; c=[x for k,v in d.items() if 'iOS' in k for x in v if x['name'].startswith('iPhone')]; print(c[-1]['udid'])")
xcrun simctl list devices available | grep "$UDID"
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP"
# Open Files once so its "On My iPhone" folder exists, then copy the compendium into it.
xcrun simctl launch "$UDID" com.apple.DocumentsApp || true
sleep 8
xcrun simctl terminate "$UDID" com.apple.DocumentsApp || true
G=$(xcrun simctl get_app_container "$UDID" com.apple.DocumentsApp groups | awk -F'\t' '/LocalStorage/{print $2}' | head -1)
[ -n "$G" ] || G=$(xcrun simctl get_app_container "$UDID" com.apple.DocumentsApp groups | awk '/LocalStorage/{print $NF}' | head -1)
mkdir -p "$G/File Provider Storage"
cp data/Complete_1.xml "$G/File Provider Storage/"
ls -la "$G/File Provider Storage"
echo "LOCAL_STORAGE=$G/File Provider Storage" >> "$GITHUB_ENV"
echo "UDID=$UDID" >> "$GITHUB_ENV"
