// Writes src-tauri/tauri.signing.json: the code-signing settings for this build, taken from
// environment variables (CI secrets). With no secrets set it writes an empty override, so
// unsigned development builds keep working. Never commit certificates, keys or passwords.
//
// Windows, one of:
//   WINDOWS_CERTIFICATE_THUMBPRINT     a certificate already in the Windows certificate store
//                                      (the release workflow imports WINDOWS_CERTIFICATE first)
//   AZURE_SIGNING_ENDPOINT + AZURE_SIGNING_ACCOUNT + AZURE_SIGNING_PROFILE
//                                      Azure Trusted Signing (with AZURE_CLIENT_ID, AZURE_TENANT_ID,
//                                      AZURE_CLIENT_SECRET for trusted-signing-cli)
// macOS and iOS: Tauri reads APPLE_* variables itself (see docs/SIGNING.md). Without them the
//                macOS app is signed ad hoc ("-"): no identity, but Apple-silicon Macs then offer
//                "Open Anyway" instead of calling the downloaded app damaged.
// Android: the Gradle build reads src-tauri/gen/android/keystore.properties (see docs/SIGNING.md).
import { writeFileSync } from 'node:fs';

const env = process.env;
const windows = {};
if (env.WINDOWS_CERTIFICATE_THUMBPRINT) {
  Object.assign(windows, {
    certificateThumbprint: env.WINDOWS_CERTIFICATE_THUMBPRINT,
    digestAlgorithm: 'sha256',
    timestampUrl: env.WINDOWS_TIMESTAMP_URL || 'http://timestamp.digicert.com',
  });
} else if (env.AZURE_SIGNING_ENDPOINT && env.AZURE_SIGNING_ACCOUNT && env.AZURE_SIGNING_PROFILE) {
  windows.signCommand = `trusted-signing-cli -e ${env.AZURE_SIGNING_ENDPOINT} -a ${env.AZURE_SIGNING_ACCOUNT} -c ${env.AZURE_SIGNING_PROFILE} -d Hearthsheet %1`;
}
const adHocMac = !env.APPLE_SIGNING_IDENTITY && !env.APPLE_CERTIFICATE;
const bundle = {
  ...(Object.keys(windows).length ? { windows } : {}),
  ...(adHocMac ? { macOS: { signingIdentity: '-' } } : {}),
};
const config = Object.keys(bundle).length ? { bundle } : {};
writeFileSync(new URL('../src-tauri/tauri.signing.json', import.meta.url), `${JSON.stringify(config, null, 2)}\n`);
console.log(Object.keys(windows).length ? `Windows signing: ${windows.signCommand ? 'Azure Trusted Signing' : 'certificate store'}` : 'No Windows signing configured: unsigned build.');
console.log(adHocMac ? 'No Apple certificate: the macOS app is signed ad hoc.' : 'macOS signing: Apple certificate.');
