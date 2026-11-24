#!/usr/bin/env bash
# Exploratory run: open the app, step to the New character window, and save what the
# accessibility layer exposes at each point. Usage: mobile.sh android|ios
set -x
mkdir -p out
maestro --version
dump() { maestro hierarchy > "out/h-$1.json" 2> "out/h-$1.err" || true; }
maestro test e2e/discover/flow1.yaml --debug-output out/debug1 > out/flow1.log 2>&1; echo "flow1 exit $?"
dump new
# Open the Race list the way a player would, then dump what the system picker shows.
cat > out/flow2.yaml <<'Y'
appId: org.hearthsheet.app
---
- tapOn: "Name"
- inputText: "Thorin"
- takeScreenshot: out/d5-name
- tapOn:
    text: ".*Dwarf.*|Race|\\(none\\)"
    index: 0
- takeScreenshot: out/d6-race-open
Y
maestro test out/flow2.yaml --debug-output out/debug2 > out/flow2.log 2>&1; echo "flow2 exit $?"
dump race-open
tail -40 out/flow1.log out/flow2.log
