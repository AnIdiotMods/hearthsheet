#!/usr/bin/env bash
# Builds the iOS app for the Simulator (the same code as the iPhone build; only the CPU target differs).
# Needs SIM_TRIPLE (aarch64-apple-ios-sim or x86_64-apple-ios) and SIM_ARCH (arm64 or x86_64).
set -euo pipefail
npm run build
cargo build --manifest-path src-tauri/Cargo.toml --release --lib --target "$SIM_TRIPLE" --features tauri/custom-protocol
[ -d src-tauri/gen/apple ] || npx tauri ios init --ci
# Xcode's "Build Rust Code" step calls back into the Tauri CLI; use the library built above instead.
python3 - <<'PY'
import os, re, pathlib
p = pathlib.Path('src-tauri/gen/apple/project.yml')
lib = f'"$SRCROOT/../../target/{os.environ["SIM_TRIPLE"]}/release/libhearthsheet_lib.a"'
cmd = ('for d in arm64 arm64-sim x86_64; do mkdir -p "$SRCROOT/Externals/$d/${CONFIGURATION}" && cp ' + lib +
       ' "$SRCROOT/Externals/$d/${CONFIGURATION}/libapp.a"; done')
lines = p.read_text().split('\n')
for i, line in enumerate(lines):
    if 'xcode-script' in line:
        m = re.match(r'^(\s*(?:- )?script:\s*)', line)
        lines[i] = (m.group(1) if m else re.match(r'^\s*', line).group(0)) + cmd
s = '\n'.join(lines)
assert 'xcode-script' not in s, 'the Rust build step in project.yml was not replaced'
p.write_text(s)
PY
(cd src-tauri/gen/apple && xcodegen generate)
PROJECT=$(ls -d src-tauri/gen/apple/*.xcodeproj | head -1)
SCHEME=$(xcodebuild -list -project "$PROJECT" | awk '/Schemes:/{f=1;next} f&&NF{print $1; exit}')
xcodebuild -project "$PROJECT" -scheme "$SCHEME" -configuration release -sdk iphonesimulator \
  -derivedDataPath "$RUNNER_TEMP/dd" ARCHS="$SIM_ARCH" ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO build | tail -5
APP=$(find "$RUNNER_TEMP/dd/Build/Products" -maxdepth 2 -name '*.app' | head -1)
echo "APP=$APP" >> "$GITHUB_ENV"
echo "Built $APP"
