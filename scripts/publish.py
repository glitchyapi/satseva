#!/usr/bin/env python3
"""Build and sign an interface release for the universal update feed.

Output layout (all plain static files, hostable anywhere):
  docs/updates/stable.json       readable, signed release document
  docs/updates/stable.json.sig   detached P-256 signature, base64
  docs/updates/ui/<path>         the interface files themselves

The device verifies the signature over the exact document bytes, then verifies
each file's SHA-256 against the digest inside that signed document. Mirrors can
be untrusted: they can withhold bytes, but they cannot substitute them.

Usage:
  python3 scripts/publish.py --notes-en "..." --notes-hi "..." [--events events.json]
  python3 scripts/publish.py --apk artifacts/SatSeva-1.0.1.apk --bump-app
"""
from pathlib import Path
import argparse
import base64
import hashlib
import json
import os
import shutil
import time

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'web'
OUT = ROOT / 'docs/updates'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_key() -> ec.EllipticCurvePrivateKey:
    path = Path(os.environ.get('UPDATE_PRIVATE_KEY', '/home/user/satseva-keys/update-private.pem'))
    if not path.exists():
        raise SystemExit(f'Signing key not found: {path}. Set UPDATE_PRIVATE_KEY.')
    return serialization.load_pem_private_key(path.read_bytes(), password=None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ui-bump', type=int, default=None, help='interface release number')
    ap.add_argument('--notes-en', action='append', default=[])
    ap.add_argument('--notes-hi', action='append', default=[])
    ap.add_argument('--notes-pa', action='append', default=[])
    ap.add_argument('--events', type=Path, default=None)
    ap.add_argument('--apk', type=Path, default=None)
    ap.add_argument('--apk-url', action='append', default=[])
    ap.add_argument('--bump-app', action='store_true')
    ap.add_argument('--min-app-code', type=int, default=None)
    ap.add_argument('--min-ui', type=int, default=None, help='force users below this interface release to update')
    ap.add_argument('--onlyfiles', action='store_true', help='also mirror files to OnlyFiles')
    args = ap.parse_args()

    config = json.loads((ROOT / 'release-config.json').read_text())
    if args.bump_app:
        config['versionCode'] = int(config['versionCode']) + 1
    ui_version = args.ui_bump if args.ui_bump is not None else int(config['uiVersion']) + 1
    config['uiVersion'] = ui_version

    ui_dir = OUT / 'ui'
    if ui_dir.exists():
        shutil.rmtree(ui_dir)
    ui_dir.mkdir(parents=True)

    onlyfiles = None
    if args.onlyfiles:
        from onlyfiles import OnlyFiles
        onlyfiles = OnlyFiles(ROOT)

    files = []
    for path in sorted(WEB.rglob('*')):
        if not path.is_file():
            continue
        rel = path.relative_to(WEB).as_posix()
        data = path.read_bytes()
        target = ui_dir / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        entry = {'path': rel, 'sha256': sha(data), 'bytes': len(data)}
        if onlyfiles:
            url = onlyfiles.upload_verified(Path(rel).name, data)
            if url:
                entry['urls'] = [url]
        files.append(entry)

    events = []
    if args.events and args.events.exists():
        events = json.loads(args.events.read_text())
    elif (ROOT / 'content/events.json').exists():
        events = json.loads((ROOT / 'content/events.json').read_text())

    doc = {
        'schema': 1,
        'channel': config.get('channel', 'stable'),
        'published': int(time.time() * 1000),
        'app': {
            'versionName': config['versionName'],
            'versionCode': int(config['versionCode']),
            'minVersionCode': int(args.min_app_code if args.min_app_code is not None
                                  else config.get('minVersionCode', 1)),
        },
        'ui': {
            'version': ui_version,
            'minAppVersionCode': int(config.get('uiMinAppVersionCode', 1)),
            'minVersion': int(args.min_ui if args.min_ui is not None else config.get('uiMinVersion', 0)),
            'bases': config['uiBases'],
            'files': files,
            'remove': [],
        },
        'content': {
            'events': events,
            'notes': {
                'en': args.notes_en or ['Interface improvements and fixes.'],
                'hi': args.notes_hi or ['इंटरफ़ेस में सुधार।'],
                'pa': args.notes_pa or ['ਇੰਟਰਫੇਸ ਵਿੱਚ ਸੁਧਾਰ।'],
            },
        },
        'push': config.get('push', {'ntfyHost': 'https://ntfy.sh', 'ntfyTopic': ''}),
    }

    if args.apk:
        data = args.apk.read_bytes()
        urls = list(args.apk_url)
        if not urls:
            urls = [
                f"https://github.com/{config['repo']}/releases/download/v{config['versionName']}/{args.apk.name}",
                f"https://raw.githubusercontent.com/{config['repo']}/main/docs/updates/apk/{args.apk.name}",
            ]
        apk_dir = OUT / 'apk'
        apk_dir.mkdir(parents=True, exist_ok=True)
        (apk_dir / args.apk.name).write_bytes(data)
        doc['app']['apk'] = {'path': args.apk.name, 'sha256': sha(data), 'bytes': len(data), 'urls': urls}

    payload = (json.dumps(doc, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    key = load_key()
    der = key.sign(payload, ec.ECDSA(hashes.SHA256()))
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'stable.json').write_bytes(payload)
    (OUT / 'stable.json.sig').write_text(base64.b64encode(der).decode() + '\n')

    config['minVersionCode'] = doc['app']['minVersionCode']
    config['uiMinVersion'] = doc['ui']['minVersion']
    (ROOT / 'release-config.json').write_text(json.dumps(config, indent=2, ensure_ascii=False) + '\n')

    total = sum(f['bytes'] for f in files)
    print(f'Signed interface release r{ui_version}: {len(files)} files, {total:,} bytes')
    print(f'  feed      {OUT / "stable.json"}')
    print(f'  signature {OUT / "stable.json.sig"}')
    if args.apk:
        print(f'  apk       {args.apk.name} ({len(data):,} bytes)')


if __name__ == '__main__':
    main()
