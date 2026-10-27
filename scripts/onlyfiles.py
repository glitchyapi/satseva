"""OnlyFiles mirror adapter.

OnlyFiles (https://onlyfiles.com) exposes an anonymous upload endpoint and
returns a *share page*, not a raw file URL. The Android client knows how to
resolve that page to its direct link, and in every case verifies the SHA-256
published in the signed feed — so the mirror is treated as untrusted transport.

This adapter is strictly optional. If OnlyFiles is unreachable, rate-limited or
changes its markup, the release still publishes from GitHub/jsDelivr/Pages.
It must never be used for journals, backups, tokens or signing keys.
"""
from pathlib import Path
import hashlib
import html
import json
import mimetypes
import re
from urllib.parse import urlparse, urljoin

import requests

HOST = 'onlyfiles.com'
API = 'https://api.onlyfiles.com/v1/upload'


class OnlyFiles:
    def __init__(self, root: Path):
        self.path = root / 'docs/updates/onlyfiles-index.json'
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.index = json.loads(self.path.read_text()) if self.path.exists() else {}

    @staticmethod
    def _get(url, maximum):
        for _ in range(5):
            p = urlparse(url)
            if p.scheme != 'https' or p.hostname != HOST or p.username or p.port not in (None, 443):
                raise ValueError('Unexpected OnlyFiles URL')
            with requests.get(url, stream=True, timeout=(15, 40), allow_redirects=False,
                              headers={'User-Agent': 'SatSeva-Publisher'}) as r:
                if r.status_code in (301, 302, 303, 307, 308):
                    url = urljoin(url, r.headers['Location'])
                    continue
                r.raise_for_status()
                data = bytearray()
                for chunk in r.iter_content(32768):
                    data.extend(chunk)
                    if len(data) > maximum:
                        raise ValueError('OnlyFiles response exceeds size bound')
                return bytes(data)
        raise ValueError('Redirect limit')

    @classmethod
    def binary(cls, page_url, maximum):
        page = cls._get(page_url, 256 * 1024).decode('utf-8', 'replace')
        m = re.search(r'href=["\'](https://onlyfiles\.com/dl/[^"\']+)["\']', page, re.I)
        if not m:
            raise ValueError('OnlyFiles direct download link unavailable')
        return cls._get(html.unescape(m.group(1)).replace('&amp;', '&'), maximum)

    def upload_verified(self, name, data):
        """Upload, read the bytes back, and only then trust the returned URL."""
        digest = hashlib.sha256(data).hexdigest()
        cached = self.index.get(digest)
        if cached and urlparse(cached.get('url', '')).hostname == HOST and cached.get('bytes') == len(data):
            return cached['url']
        try:
            r = requests.post(API,
                              files={'file': (name, data, mimetypes.guess_type(name)[0] or 'application/octet-stream')},
                              data={'expire': '0'}, timeout=(15, 90),
                              headers={'User-Agent': 'SatSeva-Publisher'})
            r.raise_for_status()
            result = r.json()
            if result.get('status') is not True:
                raise ValueError('OnlyFiles rejected upload: ' + str(result.get('error', {})))
            url = result['data']['file']['url']['full']
            if self.binary(url, len(data)) != data:
                raise ValueError('OnlyFiles returned different bytes')
        except Exception as error:
            print(f'  OnlyFiles unavailable for {name} ({type(error).__name__}); GitHub sources retained.')
            return None
        self.index[digest] = {'url': url, 'bytes': len(data), 'name': name}
        self.path.write_text(json.dumps(self.index, indent=2) + '\n')
        return url
