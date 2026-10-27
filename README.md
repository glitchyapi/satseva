# SatSeva · सतसेवा

**A quiet place for the seva you do.** An offline-first, encrypted seva diary and Bhandara banner maker for the sangat of Sant Rampal Ji Maharaj.

> Independent community project. Not an official app of any ashram or organisation, and not endorsed by one.

| | |
|---|---|
| **Download APK** | https://github.com/glitchyapi/satseva/releases/latest |
| **Website** | https://glitchyapi.github.io/satseva/ |
| **Browser preview** | https://glitchyapi.github.io/satseva/app/ |
| **Release console** | https://glitchyapi.github.io/satseva/admin/ |
| **Universal update feed** | https://raw.githubusercontent.com/glitchyapi/satseva/main/docs/updates/stable.json |

## What it does

- **Daily seva journal** — add, edit, delete, search, filter by kind of seva, weekly goal, seven-day activity, streak.
- **Bhandara** — announcements delivered in the signed feed, plus an offline banner studio with three styles and PNG export/share.
- **Three languages** — हिन्दी, English, ਪੰਜਾਬੀ, switchable at any time. The string catalogue ships in the OTA bundle, so wording and new languages arrive without reinstalling.
- **Encrypted local storage** — JSON → raw DEFLATE (best) → AES-256-GCM → atomic file. Key lives in Android Keystore, never exported.
- **Password-encrypted backups** — PBKDF2-SHA256 (210,000 iterations) + AES-256-GCM, moved through Android's document picker.
- **Signed, file-level OTA updates** — only changed files are downloaded; atomic swap; automatic rollback.
- **Version screen + forced-update gate** — with an honest "last checked" and real byte counts.
- **Notifications** — opt-in, two channels, plus a daily inexact reminder.

## What it deliberately does not do

No account. No analytics. No advertising. No server that stores anything about any user. No broad storage permission. No notification-listener access. No exact alarms. No foreground service.

## Repository layout

```
app/src/main/java/org/satseva/app/   native Android (no third-party dependencies)
app/src/main/res/                    icons, splash, theme
web/                                 the interface (this is what OTA updates)
admin/                               browser release console (GitHub Pages)
site/                                public landing page
docs/updates/                        signed feed + mirrored interface files
scripts/                             build, validate, publish, test
tests/                               JVM core tests + headless UI smoke test
```

## Building

Requires JDK 17 and Android SDK `platforms;android-34` + `build-tools;34.0.0`. No Gradle, no network at build time.

```bash
export ANDROID_HOME=/opt/android
export APK_KEYSTORE=/path/to/release.jks
export APK_STORE_PASSWORD=...
python3 scripts/build_apk.py      # → artifacts/SatSeva-X.Y.Z.apk
python3 scripts/validate_apk.py   # 46 install-critical assertions
bash scripts/test_core.sh         # compression + signature chain
```

The **same keystore must be reused for every release**, or Android will refuse to install an update over the old one.

## Publishing

Interface changes (anything in `web/`):

```bash
python3 scripts/publish.py --notes-en "..." --notes-hi "..."
git add docs/updates web release-config.json && git commit && git push
```

Or use the [Release console](https://glitchyapi.github.io/satseva/admin/), which signs in the browser and makes one atomic commit.

Native changes (Java, manifest, icon, permissions) need a new APK: dispatch **Android release** from the Actions tab or the console.

See [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), [INSTALL.md](INSTALL.md), [PRIVACY.md](PRIVACY.md).

## Licence

MIT for the code. Manrope and Noto Sans Devanagari are bundled under the SIL Open Font License (see `licenses/`). Artwork is original.
