# Security model

## Local journal

`JSON → raw DEFLATE (BEST_COMPRESSION) → AES-256-GCM → AtomicFile`

- The 256-bit key is generated inside **AndroidKeyStore** with `setRandomizedEncryptionRequired(true)` and is never exportable. On devices with a secure element it never enters application memory.
- A fixed AAD (`satseva-local-v2`) binds each ciphertext to this app and format version, so a blob lifted from elsewhere cannot be replayed.
- Every write goes through `AtomicFile`; a crash mid-write leaves the previous journal intact.
- The vault refuses to generate a fresh key when an encrypted journal already exists, so key loss surfaces as an error instead of silent, permanent data loss.
- Inflation is size-capped, so a corrupt or hostile blob cannot exhaust memory.
- Compression precedes encryption deliberately: ciphertext is incompressible, so encrypt-then-compress would store *more* bytes than plain JSON.

## Backups

`SATSEVA1 | salt(16) | IV(12) | AES-256-GCM(deflate(JSON))`, key derived with PBKDF2-HMAC-SHA256, 210,000 iterations. The password is never stored. A wrong password fails the GCM tag check rather than producing garbage.

## Update feed

One P-256 public key is compiled into the APK (`assets/update-public.der`).

1. Fetch `stable.json` and the detached `stable.json.sig` over HTTPS.
2. Verify the signature over the **exact document bytes** before parsing anything. Both DER and raw `r||s` (WebCrypto) signature encodings are accepted, each verified with a fresh `Signature` instance.
3. Only then read the manifest. Reject unknown schemas, implausible sizes, missing digests, non-HTTPS sources, and any path containing `..`, absolute paths, backslashes, drive letters or NUL.
4. Download only files whose SHA-256 differs from what is on disk (or in the APK's own assets).
5. Verify each file's size and SHA-256 before writing it into a staging directory.
6. Move the verified tree into place, then switch a single pointer. Either the whole release is live or none of it is.
7. If the new interface fails to report healthy within three launches, roll back automatically.

A mirror can therefore withhold or corrupt bytes, but cannot make a device accept them. Mirrors are tried in order: GitHub raw → jsDelivr → GitHub Pages, with optional OnlyFiles URLs per file.

## Native updates

An APK is offered to Android's installer only when **both** hold:

- its SHA-256 matches the digest in the signed manifest, and
- its signing certificate matches the certificate this app is already running under, and its package name matches.

Android then asks the user to confirm. Nothing is ever installed silently.

## WebView

The interface is served from an intercepted `https://appassets.androidplatform.net` origin, never `file://`. Consequently:

- file access, content access and universal file access are all disabled;
- mixed content is never allowed; every non-local request is blocked;
- the page carries a strict CSP with `connect-src 'none'`;
- the only JavaScript surface is the explicit `@JavascriptInterface` methods.

`ShareProvider` is read-only and can hand out exactly two things: the verified update APK, and the banner you just chose to share. The journal vault is not reachable through it.

## Keys

| Key | Purpose | Where it lives |
|---|---|---|
| APK keystore (RSA-3072) | Sign the Android package | Offline + `APK_KEYSTORE_BASE64` repository secret |
| Feed signing key (P-256) | Sign release manifests | Offline + `UPDATE_SIGNING_KEY_PEM` repository secret; optionally imported into the admin browser as a non-extractable CryptoKey |
| Journal key (AES-256) | Encrypt your entries | Android Keystore on your device, never exported |

**Neither private key is in this repository.** Losing the APK keystore means future builds cannot update existing installs; losing the feed key means installed apps will reject every future update until they install a new APK.

## Reporting

Open a GitHub issue for anything that is not exploitable in the wild. For a live vulnerability, contact the maintainer directly before publishing details.

## Honest limits

This is a community project. It has had careful design and automated testing, **not** an independent third-party security audit. A rooted device, a compromised OS, or malware with your unlocked session can read anything you can read.
