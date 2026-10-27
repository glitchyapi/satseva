#!/usr/bin/env python3
"""Build a real, signed release APK with the official Android SDK tools.

No Gradle and no network are required at build time: aapt2 compiles resources,
javac compiles the bridge, d8 produces DEX, zipalign aligns, apksigner signs
with v1+v2+v3. The same keystore must be reused for every future native
release or Android will refuse to install the update over the old one.

Environment:
  ANDROID_HOME       SDK root (default /opt/android)
  APK_KEYSTORE       path to release.jks
  APK_STORE_PASSWORD keystore + key password
  APK_KEY_ALIAS      key alias (default satseva)
"""
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SDK = Path(os.environ.get('ANDROID_HOME', '/opt/android'))
PLATFORM = SDK / 'platforms/android-34/android.jar'
tools = [p for p in sorted((SDK / 'build-tools').glob('*'), reverse=True) if (p / 'aapt2').exists()]
if not tools or not PLATFORM.exists():
    raise SystemExit('Install platforms;android-34 and build-tools;34.0.0 into ANDROID_HOME.')
TOOLS = tools[0]

JAVA_HOME = os.environ.get('JAVA_HOME', '/opt/jdk')
os.environ['JAVA_HOME'] = JAVA_HOME
os.environ['PATH'] = f"{JAVA_HOME}/bin:" + os.environ['PATH']

config = json.loads((ROOT / 'release-config.json').read_text())
code = int(os.environ.get('VERSION_CODE', config['versionCode']))
name = os.environ.get('VERSION_NAME', config['versionName'])
ui = int(os.environ.get('UI_VERSION', config['uiVersion']))
if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.]+)?', name) or code < 1 or ui < 1:
    raise SystemExit('Invalid version.')

PKG = 'org.satseva.app'
work = ROOT / 'build/apk'
if work.exists():
    shutil.rmtree(work)
for d in ['classes', 'gen', 'dex', 'assets']:
    (work / d).mkdir(parents=True, exist_ok=True)

shutil.copytree(ROOT / 'web', work / 'assets/web')
shutil.copy(ROOT / 'app/src/main/assets/update-public.der', work / 'assets/update-public.der')

feed_literals = ', '.join('"' + u.replace('"', '') + '"' for u in config['feedUrls'])
gen = work / 'gen' / PKG.replace('.', '/')
gen.mkdir(parents=True, exist_ok=True)
(gen / 'BuildConfig.java').write_text(
    f'package {PKG};\n'
    'public final class BuildConfig {\n'
    f'  public static final int VERSION_CODE = {code};\n'
    f'  public static final String VERSION_NAME = "{name}";\n'
    f'  public static final int UI_VERSION = {ui};\n'
    f'  public static final String[] FEED_URLS = new String[]{{ {feed_literals} }};\n'
    '}\n')


def run(cmd, **kw):
    print('+', ' '.join(str(Path(c).name if i == 0 else c for c in map(str, cmd))[:11]))
    subprocess.run([str(c) for c in cmd], check=True, cwd=ROOT, **kw)


run([TOOLS / 'aapt2', 'compile', '--dir', ROOT / 'app/src/main/res', '-o', work / 'resources.zip'])
run([TOOLS / 'aapt2', 'link',
     '-o', work / 'base.apk',
     '-I', PLATFORM,
     '--manifest', ROOT / 'app/src/main/AndroidManifest.xml',
     '--java', work / 'gen',
     '--min-sdk-version', '26',
     '--target-sdk-version', '34',
     '--version-code', str(code),
     '--version-name', name,
     '-A', work / 'assets',
     work / 'resources.zip',
     '--auto-add-overlay'])

sources = list((ROOT / 'app/src/main/java').rglob('*.java')) + list((work / 'gen').rglob('*.java'))
run(['javac', '-encoding', 'UTF-8', '-source', '8', '-target', '8',
     '-bootclasspath', PLATFORM, '-nowarn',
     '-cp', PLATFORM, '-d', work / 'classes', *sources])
run(['jar', 'cf', work / 'classes.jar', '-C', work / 'classes', '.'])
run([TOOLS / 'd8', '--lib', PLATFORM, '--min-api', '26', '--release',
     '--output', work / 'dex', work / 'classes.jar'])

# classes.dex is added deflated; resources.arsc is already STORED+aligned by aapt2.
with zipfile.ZipFile(work / 'base.apk', 'a', compression=zipfile.ZIP_DEFLATED) as z:
    for f in sorted((work / 'dex').glob('*.dex')):
        z.write(f, f.name)

run([TOOLS / 'zipalign', '-p', '-f', '4', work / 'base.apk', work / 'aligned.apk'])

key = Path(os.environ.get('APK_KEYSTORE', '/home/user/satseva-keys/release.jks'))
password = os.environ.get('APK_STORE_PASSWORD')
if not password:
    fallback = key.parent / 'store-password.txt'
    if fallback.exists():
        password = fallback.read_text().strip()
        os.environ['APK_STORE_PASSWORD'] = password
if not key.exists() or not password:
    raise SystemExit('A release signing key is required. No unsigned or debug APK is emitted.')

out_dir = ROOT / 'artifacts'
out_dir.mkdir(exist_ok=True)
output = out_dir / f'SatSeva-{name}.apk'
run([TOOLS / 'apksigner', 'sign',
     '--ks', key,
     '--ks-key-alias', os.environ.get('APK_KEY_ALIAS', 'satseva'),
     '--ks-pass', 'env:APK_STORE_PASSWORD',
     '--key-pass', 'env:APK_STORE_PASSWORD',
     '--v1-signing-enabled', 'true',
     '--v2-signing-enabled', 'true',
     '--v3-signing-enabled', 'true',
     '--v4-signing-enabled', 'false',
     '--out', output, work / 'aligned.apk'])
run([TOOLS / 'apksigner', 'verify', '--verbose', '--print-certs', output])
run([TOOLS / 'zipalign', '-c', '-v', '4', output], stdout=subprocess.DEVNULL)

sha = hashlib.sha256(output.read_bytes()).hexdigest()
output.with_suffix('.apk.sha256').write_text(f'{sha}  {output.name}\n')
(out_dir / 'build-info.json').write_text(json.dumps({
    'package': PKG, 'versionCode': code, 'versionName': name, 'uiVersion': ui,
    'minSdk': 26, 'targetSdk': 34, 'bytes': output.stat().st_size, 'sha256': sha,
    'apk': output.name,
}, indent=2) + '\n')
print(f'\nSIGNED + VERIFIED: {output}\nBytes: {output.stat().st_size}\nSHA-256: {sha}')
