#!/usr/bin/env python3
from pathlib import Path
import base64, copy, hashlib, json, unittest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.exceptions import InvalidSignature
ROOT=Path(__file__).resolve().parents[1]
class ReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.public=serialization.load_pem_public_key((ROOT/'update-public.pem').read_bytes())
        cls.envelope=json.loads((ROOT/'docs/updates/stable.json').read_text())
        cls.payload=base64.b64decode(cls.envelope['payload'],validate=True)
        cls.signature=base64.b64decode(cls.envelope['signature'],validate=True)
        cls.release=json.loads(cls.payload)
    def test_signature(self):
        self.public.verify(self.signature,self.payload,padding.PKCS1v15(),hashes.SHA256())
    def test_tampering_is_rejected(self):
        corrupted=bytearray(self.payload);corrupted[-5]^=1
        with self.assertRaises(InvalidSignature): self.public.verify(self.signature,bytes(corrupted),padding.PKCS1v15(),hashes.SHA256())
    def test_pinned_key(self):
        expected=self.public.public_bytes(serialization.Encoding.DER,serialization.PublicFormat.SubjectPublicKeyInfo)
        self.assertEqual(expected,(ROOT/'app/src/main/assets/update-public.der').read_bytes())
    def test_assets_match_exactly(self):
        paths=[]
        for file in self.release['ui']['files']:
            data=(ROOT/'docs/updates/files'/file['sha256']).read_bytes()
            self.assertEqual(len(data),file['bytes'])
            self.assertEqual(hashlib.sha256(data).hexdigest(),file['sha256'])
            self.assertEqual(data,(ROOT/'web'/file['path']).read_bytes())
            self.assertNotIn('..',file['path']);self.assertTrue(file['url'].startswith(('https://raw.githubusercontent.com/','https://onlyfiles.com/')))
            if file['url'].startswith('https://onlyfiles.com/'):
                self.assertTrue(file['mirrors'][0].startswith('https://raw.githubusercontent.com/'))
            paths.append(file['path'])
        self.assertEqual(len(paths),len(set(paths)));self.assertIn('index.html',paths)
    def test_delta_hashing(self):
        files=self.release['ui']['files'];local={f['path']:f['sha256'] for f in files}
        self.assertEqual([f for f in files if local.get(f['path'])!=f['sha256']],[])
        changed=copy.deepcopy(files);changed[0]['sha256']='0'*64
        self.assertEqual(len([f for f in changed if local.get(f['path'])!=f['sha256']]),1)
    def test_preview_is_explicit(self):
        text=(ROOT/'web/app.js').read_text()
        self.assertIn("typeof window.SevaNative",text)
        self.assertIn('if(NATIVE)',text)
        self.assertIn('previewStorage',(ROOT/'web/i18n.js').read_text())
    def test_no_broad_storage_or_notification_listener_permission(self):
        manifest=(ROOT/'app/src/main/AndroidManifest.xml').read_text()
        for denied in ['MANAGE_EXTERNAL_STORAGE','READ_EXTERNAL_STORAGE','WRITE_EXTERNAL_STORAGE','BIND_NOTIFICATION_LISTENER_SERVICE']:
            self.assertNotIn(denied,manifest)
        self.assertIn('POST_NOTIFICATIONS',manifest)
        self.assertIn('android:allowBackup="false"',manifest)
    def test_no_external_web_resources(self):
        html=(ROOT/'web/index.html').read_text()
        self.assertNotIn('https://',html)
        self.assertIn("connect-src 'none'",html)
        self.assertIn("frame-src 'none'",html)
if __name__=='__main__':unittest.main(verbosity=2)
