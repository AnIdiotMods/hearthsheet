#!/usr/bin/env bash
# Plays flow.yaml (made by gen-maestro.mjs) on the running Android emulator or iOS Simulator, then
# collects the screenshots, Maestro's report and the character file the session exported.
#   mobile.sh android|ios
P=$1
mkdir -p out
EXPORTED="Thorin Oakenshield.xml"
if [ "$P" = android ]; then
  adb wait-for-device
  # Emulators on shared build machines often show "… isn't responding" while they settle.
  adb shell settings put global hide_error_dialogs 1 || true
  sleep 15
  adb shell input keyevent KEYCODE_HOME || true
  adb install -r app.apk
  adb shell mkdir -p /sdcard/Download
  adb push data/Complete_1.xml /sdcard/Download/Complete_1.xml
  adb shell rm -f "/sdcard/Download/$EXPORTED"
  adb shell content call --uri content://media/external/file --method scan_volume --arg external_primary >/dev/null 2>&1 || true
fi
start=$(date +%s)
maestro test flow.yaml --debug-output out/maestro --format junit --output out/junit.xml > out/maestro.log 2>&1
code=$?
echo "Maestro exit $code after $(( $(date +%s) - start )) s"
grep -E "COMPLETED|FAILED|WARNED|SKIPPED" out/maestro.log | tail -n 200 > out/steps.txt || true
tail -n 40 out/maestro.log
maestro hierarchy > out/hierarchy-end.json 2>/dev/null || true
if [ "$P" = android ]; then
  adb pull "/sdcard/Download/$EXPORTED" out/ || adb shell ls -la /sdcard/Download/
  adb exec-out screencap -p > out/end.png
  adb logcat -d -t 3000 > out/logcat.txt || true
else
  ls -la "$LOCAL_STORAGE" || true
  cp "$LOCAL_STORAGE/$EXPORTED" out/ || true
  xcrun simctl io booted screenshot out/end.png || true
fi
exit $code
