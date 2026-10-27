package org.satseva.app;

import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.ArrayList;
import java.util.List;

/**
 * The signed release feed.
 *
 * Trust model: the APK embeds one P-256 public key. A release is a readable JSON
 * document plus a detached signature over the exact document bytes. The app
 * verifies that signature before it reads a single field, and then verifies the
 * SHA-256 of every file it downloads against the digest inside the signed
 * document. A compromised or malicious mirror can therefore serve stale or
 * broken bytes, but it cannot make the device accept them.
 */
public final class ReleaseProtocol {

    public static final class FileSpec {
        public String path, sha256;
        public long bytes;
        public final List<String> urls = new ArrayList<>();
    }

    public static final class Release {
        public String channel = "stable";
        public long published;
        public String appVersionName = "";
        public int appVersionCode, minAppVersionCode;
        public FileSpec apk;
        public int uiVersion, uiMinAppVersionCode, uiMinVersion;
        public final List<FileSpec> files = new ArrayList<>();
        public final List<String> remove = new ArrayList<>();
        public JSONArray events = new JSONArray();
        public JSONObject notes = new JSONObject();
        public String ntfyHost = "", ntfyTopic = "";
        public String sourceUrl = "";

        public long deltaBytes() {
            long n = 0;
            for (FileSpec f : files) n += f.bytes;
            return n;
        }
    }

    private final PublicKey publicKey;

    public ReleaseProtocol(InputStream derKey) throws Exception {
        byte[] der = Codec.readLimited(derKey, 4096);
        publicKey = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(der));
    }

    /** Detached signature is raw r||s (64 bytes, WebCrypto shape) or DER. */
    public boolean verify(byte[] document, byte[] signature) {
        if (signature == null || signature.length == 0) return false;
        // Each attempt needs its own Signature instance: a failed verify() can
        // leave the previous one in an unusable state, and a raw r||s blob makes
        // the DER parser throw rather than return false.
        if (attempt(document, signature)) return true;
        return signature.length == 64 && attempt(document, rawToDer(signature));
    }

    private boolean attempt(byte[] document, byte[] signature) {
        try {
            Signature verifier = Signature.getInstance("SHA256withECDSA");
            verifier.initVerify(publicKey);
            verifier.update(document);
            return verifier.verify(signature);
        } catch (Exception e) {
            return false;
        }
    }

    private static byte[] rawToDer(byte[] raw) {
        byte[] r = trim(java.util.Arrays.copyOfRange(raw, 0, 32));
        byte[] s = trim(java.util.Arrays.copyOfRange(raw, 32, 64));
        int len = 2 + r.length + 2 + s.length;
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        out.write(0x30);
        out.write(len);
        out.write(0x02); out.write(r.length); out.write(r, 0, r.length);
        out.write(0x02); out.write(s.length); out.write(s, 0, s.length);
        return out.toByteArray();
    }

    private static byte[] trim(byte[] v) {
        int i = 0;
        while (i < v.length - 1 && v[i] == 0) i++;
        byte[] out = v[i] == 0 && i == v.length - 1 ? new byte[]{0} : java.util.Arrays.copyOfRange(v, i, v.length);
        if ((out[0] & 0x80) != 0) {
            byte[] padded = new byte[out.length + 1];
            System.arraycopy(out, 0, padded, 1, out.length);
            return padded;
        }
        return out;
    }

    public Release parse(byte[] document) throws Exception {
        JSONObject root = new JSONObject(new String(document, StandardCharsets.UTF_8));
        if (root.optInt("schema", 0) != 1) throw new Exception("Unsupported feed schema");
        Release r = new Release();
        r.channel = root.optString("channel", "stable");
        r.published = root.optLong("published", 0);

        JSONObject app = root.optJSONObject("app");
        if (app != null) {
            r.appVersionName = app.optString("versionName", "");
            r.appVersionCode = app.optInt("versionCode", 0);
            r.minAppVersionCode = app.optInt("minVersionCode", 0);
            JSONObject apk = app.optJSONObject("apk");
            if (apk != null) r.apk = fileSpec(apk, null);
        }
        JSONObject ui = root.optJSONObject("ui");
        if (ui != null) {
            r.uiVersion = ui.optInt("version", 0);
            r.uiMinAppVersionCode = ui.optInt("minAppVersionCode", 0);
            r.uiMinVersion = ui.optInt("minVersion", 0);
            List<String> bases = new ArrayList<>();
            JSONArray jb = ui.optJSONArray("bases");
            if (jb != null) for (int i = 0; i < jb.length(); i++) bases.add(jb.getString(i));
            JSONArray files = ui.optJSONArray("files");
            if (files != null) {
                if (files.length() > 500) throw new Exception("Too many files in release");
                for (int i = 0; i < files.length(); i++) {
                    JSONObject f = files.getJSONObject(i);
                    String path = f.getString("path");
                    if (!safePath(path)) throw new Exception("Unsafe path in release: " + path);
                    r.files.add(fileSpec(f, bases));
                }
            }
            JSONArray rm = ui.optJSONArray("remove");
            if (rm != null) for (int i = 0; i < rm.length(); i++) {
                String p = rm.getString(i);
                if (!safePath(p)) throw new Exception("Unsafe removal path");
                r.remove.add(p);
            }
        }
        JSONObject content = root.optJSONObject("content");
        if (content != null) {
            r.events = content.optJSONArray("events") == null ? new JSONArray() : content.getJSONArray("events");
            r.notes = content.optJSONObject("notes") == null ? new JSONObject() : content.getJSONObject("notes");
        }
        JSONObject push = root.optJSONObject("push");
        if (push != null) {
            r.ntfyHost = Http.safeHttps(push.optString("ntfyHost", ""));
            r.ntfyTopic = push.optString("ntfyTopic", "").replaceAll("[^A-Za-z0-9_-]", "");
        }
        return r;
    }

    private static FileSpec fileSpec(JSONObject o, List<String> bases) throws Exception {
        FileSpec f = new FileSpec();
        f.path = o.optString("path", "");
        f.sha256 = o.optString("sha256", "").toLowerCase(java.util.Locale.ROOT);
        f.bytes = o.optLong("bytes", 0);
        if (f.sha256.length() != 64) throw new Exception("Missing digest");
        if (f.bytes <= 0 || f.bytes > 64L * 1024 * 1024) throw new Exception("Implausible file size");
        JSONArray urls = o.optJSONArray("urls");
        if (urls != null) for (int i = 0; i < urls.length(); i++) {
            String u = Http.safeHttps(urls.getString(i));
            if (!u.isEmpty()) f.urls.add(u);
        }
        if (bases != null && !f.path.isEmpty()) {
            for (String b : bases) {
                String base = Http.safeHttps(b);
                if (base.isEmpty()) continue;
                f.urls.add(base.endsWith("/") ? base + f.path : base + "/" + f.path);
            }
        }
        if (f.urls.isEmpty()) throw new Exception("No usable HTTPS source for " + f.path);
        return f;
    }

    /** Blocks traversal, absolute paths, backslashes and NUL before any file write. */
    public static boolean safePath(String p) {
        if (p == null || p.isEmpty() || p.length() > 200) return false;
        if (p.startsWith("/") || p.contains("\\") || p.contains("\u0000") || p.contains(":")) return false;
        for (String part : p.split("/")) if (part.isEmpty() || part.equals(".") || part.equals("..")) return false;
        return p.matches("[A-Za-z0-9._/-]+");
    }
}
