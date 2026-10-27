# Installing SatSeva

**Requires Android 8.0 (API 26) or newer and a working Android System WebView.**

1. Download `SatSeva-X.Y.Z.apk` from [Releases](https://github.com/glitchyapi/satseva/releases/latest).
2. Open the **file**, not the GitHub page. Use your browser's downloads list or your Files app.
3. Android will say the install is blocked from this source. Tap **Settings** in that dialog, allow your browser/file manager to install apps, go back, tap **Install**.
4. Open SatSeva. It starts empty.

The APK is a few hundred kilobytes because it uses the system WebView rather than shipping a browser engine. That is expected — it is a real compiled, signed Android package with DEX bytecode, resources and assets, not a renamed web page.

## "App not installed" / "There was a problem parsing the package"

Work through these in order:

| Symptom | Cause | Fix |
|---|---|---|
| *App not installed* after tapping Install | An app with package `org.satseva.app` is already installed but signed with a **different key** | Export an encrypted backup from the old app, uninstall it, install this one, restore the backup |
| *Problem parsing the package* | The download is incomplete, or you opened an HTML page saved as `.apk` | Re-download; check the file is a few hundred KB and ends in `.apk`; compare against the published `.sha256` |
| *Install blocked* | Unknown sources not allowed for the installing app | Allow it for that specific app in the dialog Android shows |
| Play Protect warning | Normal for any app distributed outside Play Store | Choose **Install anyway** if you downloaded from this repository |
| Opens to a blank screen | Android System WebView is disabled or badly out of date | Update/enable **Android System WebView** in Play Store |

Earlier builds of this project used the package names `org.sevasaathi.app` and others. Those are **different apps** and will not conflict with SatSeva — you can uninstall them once you have moved your entries across with an encrypted backup.

## Verifying a download

```bash
sha256sum SatSeva-1.0.0.apk
# compare with SatSeva-1.0.0.apk.sha256 attached to the same release
```

## Updating later

- **Interface updates** arrive inside the app: Settings → App version → Check now. Only changed files download. Your journal is untouched.
- **Android updates** are announced in the app; you download and confirm the install yourself. Android never installs silently.
