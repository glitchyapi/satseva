#!/usr/bin/env python3
"""Static acceptance checks for the release APK.

These are the failure modes that actually produce "App not installed" or
"There was a problem parsing the package" on a real device, so each one is
asserted here rather than assumed.
"""
from pathlib import Path
import json
import re
import subprocess
import sys
import zipfile
import os
import hashlib

ROOT = Path(__file__).resolve().parents[1]
SDK = Path(os.environ.get('ANDROID_HOME', '/opt/android'))
TOOLS = next(p for p in sorted((SDK / 'build-tools').glob('*'), reverse=True) if (p / 'aapt2').exists())
os.environ.setdefault('JAVA_HOME', '/opt/jdk')
os.environ['PATH'] = os.environ['JAVA_HOME'] + '/bin:' + os.environ['PATH']

info = json.loads((ROOT / 'artifacts/build-info.json').read_text())
apk = ROOT / 'artifacts' / info['apk']
fails, checks = [], []


def check(name, ok, detail=''):
    checks.append((name, ok, detail))
    print(('  PASS  ' if ok else '  FAIL  ') + name + (' — ' + detail if detail else ''))
    if not ok:
        fails.append(name)


print(f'Validating {apk.name} ({apk.stat().st_size:,} bytes)\n')

# 1. integrity of the file itself
digest = hashlib.sha256(apk.read_bytes()).hexdigest()
check('SHA-256 matches build record', digest == info['sha256'], digest[:16] + '…')

# 2. signature
r = subprocess.run([str(TOOLS / 'apksigner'), 'verify', '--verbose', '--print-certs', str(apk)],
                   capture_output=True, text=True)
check('apksigner verifies', r.returncode == 0)
check('v2 signature present', 'Verified using v2 scheme (APK Signature Scheme v2): true' in r.stdout)
check('v3 signature present', 'Verified using v3 scheme (APK Signature Scheme v3): true' in r.stdout)

# 3. alignment — resources.arsc must be STORED and 4-byte aligned for targetSdk 30+
r = subprocess.run([str(TOOLS / 'zipalign'), '-c', '-v', '4', str(apk)], capture_output=True, text=True)
check('zipalign 4-byte verification', r.returncode == 0)
z = zipfile.ZipFile(apk)
arsc = z.getinfo('resources.arsc')
check('resources.arsc is STORED (uncompressed)', arsc.compress_type == zipfile.ZIP_STORED)
# compute the local-header data offset the same way Android does
with apk.open('rb') as fh:
    fh.seek(arsc.header_offset)
    header = fh.read(30)
    name_len = int.from_bytes(header[26:28], 'little')
    extra_len = int.from_bytes(header[28:30], 'little')
    data_offset = arsc.header_offset + 30 + name_len + extra_len
check('resources.arsc data 4-byte aligned', data_offset % 4 == 0, f'offset {data_offset}')

# 4. manifest sanity
r = subprocess.run([str(TOOLS / 'aapt'), 'dump', 'badging', str(apk)], capture_output=True, text=True)
bad = r.stdout
check('aapt can parse the package', r.returncode == 0)
pkg = re.search(r"package: name='([^']+)'", bad)
check('package name', bool(pkg) and pkg.group(1) == info['package'], pkg.group(1) if pkg else 'none')
minsdk = re.search(r"sdkVersion:'(\d+)'", bad)
target = re.search(r"targetSdkVersion:'(\d+)'", bad)
check('minSdk 26 (Android 8.0+)', bool(minsdk) and minsdk.group(1) == '26')
check('targetSdk 34', bool(target) and target.group(1) == '34')
launch = re.search(r"launchable-activity: name='([^']+)'", bad)
check('has a launchable activity', bool(launch), launch.group(1) if launch else 'none')
check('versionCode matches', f"versionCode='{info['versionCode']}'" in bad)
check('versionName matches', f"versionName='{info['versionName']}'" in bad)
check('not debuggable', 'application-debuggable' not in bad)

# 5. DEX: present, and a version the oldest supported device can load
dexes = [n for n in z.namelist() if re.fullmatch(r'classes\d*\.dex', n)]
check('DEX bytecode present', len(dexes) >= 1, ', '.join(dexes))
magic = z.read(dexes[0])[:8]
ver = magic[4:7].decode()
check('DEX version valid for API 26', ver in ('035', '037', '038'), 'dex ' + ver)

# 6. every component named in the manifest must actually exist in the DEX
dex_blob = b''.join(z.read(n) for n in dexes)
components = ['MainActivity', 'SatSevaApp', 'UpdateJob', 'BootReceiver', 'Reminders', 'ShareProvider']
for c in components:
    needle = f'Lorg/satseva/app/{c};'.encode()
    check(f'component in DEX: {c}', needle in dex_blob)

# 7. bridge + payload assets
names = set(z.namelist())
for asset in ['assets/web/index.html', 'assets/web/app.js', 'assets/web/app.css',
              'assets/web/i18n.js', 'assets/update-public.der',
              'assets/web/assets/logo.svg', 'assets/web/assets/hero-diya.webp']:
    check('bundled ' + asset, asset in names)
check('bridge symbol present', b'SatSevaNative' in dex_blob)
check('entry origin present', b'appassets.androidplatform.net' in dex_blob)

# 8. adaptive icon at every density + themed icon
for bucket in ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']:
    check(f'launcher icon {bucket}', f'res/mipmap-{bucket}-v4/ic_launcher.png' in names)
check('adaptive icon (API 26+)', 'res/mipmap-anydpi-v26/ic_launcher.xml' in names)
check('themed icon (API 33+)', 'res/mipmap-anydpi-v33/ic_launcher.xml' in names)

# 9. no secrets shipped
for n in names:
    if n.endswith(('.jks', '.pem', '.p8', '.keystore')) and 'public' not in n:
        check('no private key in APK: ' + n, False)
check('no keystore shipped', not any(n.endswith('.jks') for n in names))

# 10. dangerous permissions we deliberately avoided
for perm in ['READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', 'MANAGE_EXTERNAL_STORAGE',
             'SCHEDULE_EXACT_ALARM', 'FOREGROUND_SERVICE', 'ACCESS_FINE_LOCATION']:
    check('does not request ' + perm, f"uses-permission: name='android.permission.{perm}'" not in bad)

print(f'\n{len(checks) - len(fails)}/{len(checks)} checks passed.')
if fails:
    print('FAILED: ' + ', '.join(fails))
    sys.exit(1)
print('APK IS STRUCTURALLY VALID FOR INSTALLATION.')
