# Privacy

There is no server that knows you exist.

## What is stored, and where

| Data | Where | Protection |
|---|---|---|
| Your seva entries, name, village, goals, settings | `files/journal.vault` inside the app's private storage | DEFLATE then AES-256-GCM; key in Android Keystore, non-exportable |
| A banner you chose to share | `cache/share/`, cleared on the next share | Ordinary app cache, deleted by Android under pressure |
| A downloaded update APK | `cache/updates/` | Verified before use; not personal data |
| Encrypted backups | Wherever **you** save them via the file picker | PBKDF2-SHA256 210,000 iterations + AES-256-GCM with your password |

Nothing above is included in Android cloud backup or device-to-device transfer — both are explicitly disabled in the manifest and in `data_extraction_rules.xml`.

## What leaves the device

Only these, and only when a check runs:

- HTTPS GET of the signed update feed and, if an update exists, the changed files.
- HTTPS GET of the public ntfy alert topic, if a topic is configured.

These requests carry no identifier, no account, no journal content and no advertising ID. The update sources see an IP address and a `SatSeva-Updater` user agent, as any web request does.

## What is never collected

Location. Contacts. Photos (the app cannot browse your gallery). Device identifiers. Usage analytics. Crash reports. Advertising IDs. Notification content from other apps.

## Permissions, and why

| Permission | Why | When asked |
|---|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE` | Read the signed update feed | Install time, normal |
| `POST_NOTIFICATIONS` | Tell you about updates and announcements | Only when you turn notifications on |
| `RECEIVE_BOOT_COMPLETED` | Re-arm the background check and daily reminder after a restart | Install time, normal |
| `REQUEST_INSTALL_PACKAGES` | Hand a verified APK to Android's installer | Only when you tap Install update |

Saving a banner uses MediaStore on Android 10+ and the system document picker below that; backups always use the document picker. **No storage permission is requested at all**, because none is needed.

## Deleting your data

Uninstalling the app removes everything. There is no copy anywhere else. If you want to keep your entries, export an encrypted backup first.
