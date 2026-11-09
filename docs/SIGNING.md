# Signing Hearthsheet so it isn't flagged

Windows and macOS warn about, or block, programs that are not digitally signed by an identity
they trust. Microsoft Defender SmartScreen shows "Windows protected your PC" and some antivirus
tools flag new unsigned installers. macOS Gatekeeper refuses to open unsigned apps. A signature
proves who published the app and that nobody changed it since.

**A trusted signature can't be generated for free here.** It comes from an identity that Microsoft
or Apple has verified, and that verification costs money and needs your legal name or company. A
self-made ("self-signed") certificate does not remove the warnings. The project is set up so that
once you have the credentials, you add them as GitHub repository secrets, and every release built by
`.github/workflows/release.yml` is signed automatically. Nothing secret is ever committed.

Add secrets in GitHub: **Settings → Secrets and variables → Actions → New repository secret**.

## Windows

Choose one:

1. **Azure Trusted Signing** (Microsoft's own service; about US$10 a month). It is usually the
   cheapest and quickest way to be trusted by SmartScreen. Microsoft verifies your identity (as an
   individual or an organization, in the supported countries), then you create a certificate profile.
   Secrets:
   - `AZURE_SIGNING_ENDPOINT`: e.g. `https://eus.codesigning.azure.net`
   - `AZURE_SIGNING_ACCOUNT`: the Trusted Signing account name
   - `AZURE_SIGNING_PROFILE`: the certificate profile name
   - `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_CLIENT_SECRET`: an app registration with the
     "Trusted Signing Certificate Profile Signer" role
2. **A code-signing certificate** from a certificate authority (Sectigo, DigiCert, SSL.com, …), as a
   `.pfx` file. New certificates are usually issued on a hardware token or as a cloud signing
   service rather than as a file; if yours is a file, add:
   - `WINDOWS_CERTIFICATE`: the `.pfx` file, base64-encoded (`base64 -w0 cert.pfx`)
   - `WINDOWS_CERTIFICATE_PASSWORD`: its password
3. **SignPath Foundation**: free code signing for open-source projects that qualify (apply at
   signpath.org). It signs through its own CI integration.

Even when signed, a brand-new publisher can see a SmartScreen warning for a short while until
downloads build up its reputation. If an antivirus product flags a release, report it as a false
positive (Microsoft: the Defender submission portal; others have similar forms).

## macOS

Join the **Apple Developer Program** (US$99 a year). Create a **Developer ID Application**
certificate, export it from Keychain Access as a `.p12`, and create an app-specific password for your
Apple ID. Secrets:

- `APPLE_CERTIFICATE`: the `.p12`, base64-encoded
- `APPLE_CERTIFICATE_PASSWORD`: the `.p12` password
- `APPLE_SIGNING_IDENTITY`: e.g. `Developer ID Application: Your Name (TEAMID)`
- `APPLE_ID`, `APPLE_PASSWORD` (the app-specific password), `APPLE_TEAM_ID`

Tauri then signs and **notarizes** the app, so it opens without warnings. Without these, people
have to right-click the app and choose Open the first time.

## iOS

iPhones and iPads only install apps signed through an Apple Developer account (the same US$99 a
year). Distribution is through TestFlight or the App Store. Set these secrets, and the repository
**variable** `IOS_ENABLED` to `true` (Settings → Secrets and variables → Actions → Variables):

- `APPLE_TEAM_ID`
- `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `APPLE_API_KEY_P8`: an App Store Connect API key (the
  contents of the `.p8` file)

## Android

Android apps are signed with a key you create yourself (no certificate authority). **Keep the
keystore and its password safe forever**: updates must be signed with the same key, or Android
refuses to install them over the old version.

- Create one: `keytool -genkeypair -keystore hearthsheet-release.jks -alias hearthsheet -keyalg RSA -keysize 4096 -validity 10000`
- Secrets: `ANDROID_KEYSTORE` (the `.jks` file, base64-encoded), `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`
- Local builds: put `storeFile=…`, `keyAlias=…` and `password=…` in
  `src-tauri/gen/android/keystore.properties` (ignored by git).

Phones show a warning for any app installed outside an app store. Publishing on Google Play (or
registering as a developer where Google requires it) removes that.

## Linux

Linux has no system-wide signing warning. Optionally, sign the AppImage with GPG: add
`LINUX_GPG_PRIVATE_KEY` (an exported armored private key), `LINUX_GPG_KEY_ID` and
`LINUX_GPG_PASSPHRASE`.
