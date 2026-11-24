#!/usr/bin/env bash
# Exploratory run on macOS: can this machine drive the app through accessibility (System Events)?
set -x
mkdir -p out
curl -sSL -o app.dmg https://github.com/AnIdiotMods/hearthsheet/raw/builds/0.4.0/Hearthsheet_0.4.0_universal.dmg
hdiutil attach -nobrowse -mountpoint /tmp/hs app.dmg
cp -R /tmp/hs/Hearthsheet.app /Applications/
hdiutil detach /tmp/hs
codesign -dv /Applications/Hearthsheet.app 2>&1 | head -5
open /Applications/Hearthsheet.app
sleep 8
screencapture -x out/m1-launch.png
osascript -e 'tell application "System Events" to get name of every process whose background only is false' > out/m-procs.txt 2>&1
time osascript -l JavaScript e2e/discover/mac-dump.js 60 > out/m-tree1.txt 2> out/m-tree1.err; echo "dump exit $?"; head -c 3000 out/m-tree1.err
head -80 out/m-tree1.txt
# Press "Compendium" through accessibility, like VoiceOver or a click would.
cat > /tmp/press.js <<'J'
function run(argv) {
  const se = Application('System Events');
  const w = se.processes.byName('Hearthsheet').windows[0];
  const all = w.entireContents();
  for (const el of all) {
    let n = ''; try { n = el.name() || el.description() || ''; } catch (e) {}
    if (n === argv[0]) { el.actions.byName('AXPress').perform(); return 'pressed ' + n; }
  }
  return 'not found: ' + argv[0];
}
J
time osascript -l JavaScript /tmp/press.js Compendium > out/m-press.txt 2>&1; cat out/m-press.txt
sleep 2; screencapture -x out/m2-compendium.png
osascript -l JavaScript /tmp/press.js "Add SRD sample" >> out/m-press.txt 2>&1
osascript -l JavaScript /tmp/press.js "Characters" >> out/m-press.txt 2>&1
osascript -l JavaScript /tmp/press.js "New character" >> out/m-press.txt 2>&1
sleep 2; screencapture -x out/m3-new.png
cat out/m-press.txt
osascript -l JavaScript e2e/discover/mac-dump.js 60 > out/m-tree-new.txt 2>&1
# Also try a CGEvent mouse click (the most person-like input) at the centre of the window.
which cliclick || brew install cliclick >/dev/null 2>&1
cliclick -V 2>&1 | head -2
