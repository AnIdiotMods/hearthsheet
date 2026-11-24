# Hearthsheet builds

Ready-to-install builds of [Hearthsheet](https://github.com/AnIdiotMods/hearthsheet). The source code is on the `main` branch.

## 0.4.0

| System | Download | Notes |
| --- | --- | --- |
| Windows 10/11 | [Hearthsheet_0.4.0_x64-setup.exe](https://github.com/AnIdiotMods/hearthsheet/raw/builds/0.4.0/Hearthsheet_0.4.0_x64-setup.exe) | Installs for your user only. |
| Windows (no install) | [Hearthsheet_0.4.0_x64-portable.zip](https://github.com/AnIdiotMods/hearthsheet/raw/builds/0.4.0/Hearthsheet_0.4.0_x64-portable.zip) | Unzip and run `Hearthsheet.exe`. |
| Linux (any) | [Hearthsheet_0.4.0_amd64.AppImage](https://github.com/AnIdiotMods/hearthsheet/raw/builds/0.4.0/Hearthsheet_0.4.0_amd64.AppImage) | Make it executable, then run it. |
| Debian / Ubuntu | [Hearthsheet_0.4.0_amd64.deb](https://github.com/AnIdiotMods/hearthsheet/raw/builds/0.4.0/Hearthsheet_0.4.0_amd64.deb) | |
| Fedora / openSUSE | [Hearthsheet-0.4.0-1.x86_64.rpm](https://github.com/AnIdiotMods/hearthsheet/raw/builds/0.4.0/Hearthsheet-0.4.0-1.x86_64.rpm) | |
| macOS 11+ (Apple silicon and Intel) | [Hearthsheet_0.4.0_universal.dmg](https://github.com/AnIdiotMods/hearthsheet/raw/builds/0.4.0/Hearthsheet_0.4.0_universal.dmg) | Open it and drag Hearthsheet to Applications. The app alone: [Hearthsheet_0.4.0_macOS.app.tar.gz](https://github.com/AnIdiotMods/hearthsheet/raw/builds/0.4.0/Hearthsheet_0.4.0_macOS.app.tar.gz). First open: see below. |
| iPhone / iPad (iOS 15+) | [Hearthsheet_0.4.0_iOS-unsigned.ipa](https://github.com/AnIdiotMods/hearthsheet/raw/builds/0.4.0/Hearthsheet_0.4.0_iOS-unsigned.ipa) | Install with a sideloading tool; see below. |
| Android 7+ | [Hearthsheet_0.4.0_android.apk](https://github.com/AnIdiotMods/hearthsheet/raw/builds/0.4.0/Hearthsheet_0.4.0_android.apk) | Allow installing from your browser or file manager when asked. The [.aab](https://github.com/AnIdiotMods/hearthsheet/raw/builds/0.4.0/Hearthsheet_0.4.0_android.aab) is for the Play Store. |

[Healer-5.5e-homebrew.xml](https://github.com/AnIdiotMods/hearthsheet/raw/builds/0.4.0/Healer-5.5e-homebrew.xml) is the Healer class (Spaghetti0's homebrew) converted for Hearthsheet: import it under Compendium → Import XML.

**macOS, first open:** the app is not signed by an Apple developer yet, so macOS says it can't check it for malware. Choose Done, then open System Settings → Privacy & Security and click **Open Anyway** next to Hearthsheet. On macOS 14 and earlier you can instead right-click the app and choose Open.

**iPhone / iPad:** Apple only lets apps from the App Store or TestFlight install directly. Until there is an Apple Developer account, install the `.ipa` with a sideloading tool such as [Sideloadly](https://sideloadly.io) or [AltStore](https://altstore.io), which signs it with your own free Apple ID as it installs. On iOS 16 and later, turn on Settings → Privacy & Security → Developer Mode when asked. Apps installed this way with a free Apple ID stop opening after 7 days; install it again (AltStore can refresh it for you).

The macOS and iPhone apps are built on GitHub's Mac machines by the release workflow on the `main` branch (Actions tab).

These builds are not code-signed yet, so Windows SmartScreen ("Windows protected your PC" → More info → Run anyway) warns the first time. Checksums: [SHA256SUMS.txt](https://github.com/AnIdiotMods/hearthsheet/raw/builds/0.4.0/SHA256SUMS.txt).
