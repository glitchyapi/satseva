# Architecture

## The shape of the app

```
┌──────────────────────── Android APK (org.satseva.app) ────────────────────────┐
│                                                                               │
│  MainActivity ── WebView ── https://appassets.androidplatform.net/assets/…    │
│       │            ▲                     ▲                                    │
│       │            │ SatSevaNative       │ shouldInterceptRequest              │
│       │            │ (explicit bridge)   │                                    │
│       │            │              LocalResourceServer                         │
│       │            │                     │                                    │
│       │            │              active UI dir  ──fallback──► APK assets/web │
│       ▼            │                                                          │
│    Vault      UpdateManager ── signed feed ──► GitHub raw / jsDelivr / Pages  │
│  (Keystore)         │                          (+ optional OnlyFiles)         │
│                     ├── file-level delta → staging → verify → atomic swap     │
│                     └── APK → sha256 + certificate match → Android installer  │
│                                                                               │
│  UpdateJob (JobScheduler, 15 min) ── feed check + ntfy poll                   │
│  Reminders (inexact alarm) ── daily nudge                                     │
│  ShareProvider ── read-only window onto the update APK and one shared banner  │
└───────────────────────────────────────────────────────────────────────────────┘
```

There are **no third-party runtime dependencies**. Everything is the Android platform API plus `org.json`. That is why the APK is ~620 KB: the system provides the browser engine, the fonts and the crypto.

## Why a WebView, and why that is still a real app

The native layer owns everything that matters: the encrypted vault, the keystore key, permissions, notifications, alarms, the file picker, MediaStore, the installer hand-off and the entire update trust chain. The WebView renders the interface and holds no authority of its own.

This split is what makes file-level OTA possible. Google Play's Device and Network Abuse policy explicitly exempts "code that runs in a virtual machine or an interpreter … such as JavaScript in a webview", and this app is distributed outside Play anyway. Native changes still require a new APK — the app says so plainly rather than pretending otherwise.

## Update protocol

`docs/updates/stable.json` (readable) + `stable.json.sig` (detached, base64).

```jsonc
{
  "schema": 1,
  "channel": "stable",
  "published": 1793127534303,
  "app":  { "versionName": "1.0.0", "versionCode": 1, "minVersionCode": 1,
            "apk": { "sha256": "…", "bytes": 630558, "urls": ["https://…"] } },
  "ui":   { "version": 2, "minAppVersionCode": 1, "minVersion": 0,
            "bases": ["https://raw.githubusercontent.com/…/docs/updates/ui/"],
            "files": [{ "path": "app.js", "sha256": "…", "bytes": 41234 }],
            "remove": [] },
  "content": { "events": [], "notes": { "en": [], "hi": [], "pa": [] } },
  "push": { "ntfyHost": "https://ntfy.sh", "ntfyTopic": "satseva-…" }
}
```

Decision order on the device:

1. `installedCode < app.minVersionCode` → **Update required** gate.
2. `app.versionCode > installedCode` → offer the APK.
3. else `ui.version > installedUi` and `ui.minAppVersionCode ≤ installedCode` → compute the delta.
4. `ui.minVersion > installedUi` → the gate, satisfied by an interface update.

A file is downloaded only if its digest differs from the copy in the active UI directory **and** from the copy bundled in the APK. Unchanged files are carried forward, never re-fetched.

## Storage figures are measured, not claimed

`Vault` records the real byte counts of the last write (`raw`, `compressed`, `stored`) and the Storage screen displays them. On a realistic 400-entry journal the JVM test measures 48,703 → 1,233 bytes before the 33-byte encryption overhead. Repetitive JSON compresses extremely well; short journals compress less, and the screen shows whatever is true.

## Push without a push server

There is no Firebase project and no user registry. The feed carries an unguessable [ntfy](https://ntfy.sh) topic. The app subscribes while open and polls `/<topic>/json?poll=1&since=…` from the 15-minute JobScheduler job. The admin console publishes with one HTTP POST.

This is genuinely server-initiated messaging, but delivery is **best effort**: Doze, OEM battery managers and the 15-minute platform minimum all apply. The app's own copy says so instead of promising instant delivery.

## Failure handling

| Failure | Behaviour |
|---|---|
| Mirror unreachable | Try the next mirror; the journal is unaffected |
| Signature invalid | Reject the whole feed; keep the cached, previously verified one |
| One file fails its digest | Abort the release, delete staging, stay on the current interface |
| New interface never reports healthy | Roll back after three launches |
| Keystore key missing but journal present | Surface an error; never mint a new key over existing data |
| Push topic unreachable | Ignored silently; the app works normally |
| No WebView / disabled WebView | Android shows its own error; INSTALL.md covers the fix |
