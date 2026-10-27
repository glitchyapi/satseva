package org.satseva.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.os.Build;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Signed, file-level over-the-air updates.
 *
 * Interface updates ship as a set of files with digests. The device compares
 * each digest against what it already has and downloads only what changed, into
 * a staging directory. Nothing is switched over until every file has been
 * fetched AND hash-verified; the swap is a single pointer write. If the new
 * interface fails to report itself healthy, the previous one is restored.
 *
 * Native (APK) updates are separate and are never silent: the bytes are
 * verified against the signed digest, the signing certificate is compared to
 * the installed app's certificate, and Android's own installer asks the user.
 */
public final class UpdateManager {

    public interface Listener { void onState(); }

    private static final String PREFS = "satseva-update";
    private static final String K_UI_VERSION = "uiVersion";
    private static final String K_PENDING = "pendingUi";
    private static final String K_BOOTS = "pendingBoots";
    private static final String K_CHECKED = "checked";
    private static final String K_SEEN_NEWS = "seenNews";
    private static final String K_AUTO = "auto";
    private static final String K_FEED = "feedCache";
    private static final String K_SIG = "feedSig";

    private final Context ctx;
    private final SharedPreferences prefs;
    private final ReleaseProtocol protocol;
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private Listener listener;

    private volatile String status = "idle";
    private volatile int progress = 0;
    private volatile String error = "";
    private volatile ReleaseProtocol.Release release;
    private volatile boolean apkReady, required;
    private volatile ReleaseProtocol.FileSpec pendingApk;
    private volatile List<ReleaseProtocol.FileSpec> delta = new ArrayList<>();

    public UpdateManager(Context ctx) throws Exception {
        this.ctx = ctx.getApplicationContext();
        this.prefs = this.ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        this.protocol = new ReleaseProtocol(this.ctx.getAssets().open("update-public.der"));
        restoreCachedFeed();
        rollbackIfNeeded();
    }

    public void setListener(Listener l) { listener = l; }
    private void emit() { Listener l = listener; if (l != null) l.onState(); }

    /* ------------------------------------------------------------ directories */
    public File uiRoot() { return new File(ctx.getFilesDir(), "ui"); }
    public File activeUi() { return new File(uiRoot(), "r" + prefs.getInt(K_UI_VERSION, 0)); }
    private File stagingUi(int version) { return new File(uiRoot(), ".staging-r" + version); }
    public File apkFile() { return new File(ctx.getCacheDir(), "updates/release.apk"); }

    public int installedUiVersion() { return prefs.getInt(K_UI_VERSION, BuildConfig.UI_VERSION); }

    public void setAutoUpdate(boolean on) { prefs.edit().putBoolean(K_AUTO, on).apply(); }
    public boolean autoUpdate() { return prefs.getBoolean(K_AUTO, true); }

    /* ----------------------------------------------------------- feed sources */
    public List<String> feedUrls() {
        List<String> out = new ArrayList<>();
        for (String u : BuildConfig.FEED_URLS) {
            String safe = Http.safeHttps(u);
            if (!safe.isEmpty()) out.add(safe);
        }
        return out;
    }

    private void restoreCachedFeed() {
        String doc = prefs.getString(K_FEED, null), sig = prefs.getString(K_SIG, null);
        if (doc == null || sig == null) return;
        try {
            byte[] d = doc.getBytes(StandardCharsets.UTF_8);
            byte[] s = android.util.Base64.decode(sig, android.util.Base64.NO_WRAP);
            if (!protocol.verify(d, s)) { prefs.edit().remove(K_FEED).remove(K_SIG).apply(); return; }
            release = protocol.parse(d);
            recompute();
        } catch (Exception ignored) {
            prefs.edit().remove(K_FEED).remove(K_SIG).apply();
        }
    }

    /* --------------------------------------------------------------- checking */
    public void check(final boolean userInitiated) {
        if (!busy.compareAndSet(false, true)) return;
        status = "checking"; error = ""; emit();
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    ReleaseProtocol.Release found = fetchFeed();
                    release = found;
                    prefs.edit().putLong(K_CHECKED, System.currentTimeMillis()).apply();
                    recompute();
                    error = "";
                    maybeNotify(found);
                    boolean haveWork = !delta.isEmpty() || apkUpdateAvailable();
                    status = haveWork ? "available" : "idle";
                    if (autoUpdate() && !delta.isEmpty() && !apkUpdateAvailable() && !required) {
                        busy.set(false);
                        emit();
                        downloadUi();
                        return;
                    }
                } catch (Exception e) {
                    error = describe(e);
                    status = "idle";
                } finally {
                    busy.set(false);
                    emit();
                }
            }
        }, "satseva-check").start();
    }

    private ReleaseProtocol.Release fetchFeed() throws Exception {
        Exception last = null;
        for (String base : feedUrls()) {
            try {
                byte[] doc = Http.get(base, 512 * 1024);
                byte[] sig = Http.get(base + ".sig", 4096);
                sig = new String(sig, StandardCharsets.UTF_8).trim().getBytes(StandardCharsets.UTF_8);
                byte[] sigBytes = android.util.Base64.decode(sig, android.util.Base64.DEFAULT);
                if (!protocol.verify(doc, sigBytes)) throw new IOException("Signature verification failed");
                ReleaseProtocol.Release r = protocol.parse(doc);
                r.sourceUrl = base;
                prefs.edit().putString(K_FEED, new String(doc, StandardCharsets.UTF_8))
                        .putString(K_SIG, android.util.Base64.encodeToString(sigBytes, android.util.Base64.NO_WRAP)).apply();
                return r;
            } catch (Exception e) {
                last = e;
            }
        }
        throw last == null ? new IOException("No update source configured") : last;
    }

    private boolean apkUpdateAvailable() {
        return release != null && release.apk != null && release.appVersionCode > BuildConfig.VERSION_CODE;
    }

    /** Compare every advertised digest with the bytes actually on disk. */
    private void recompute() throws Exception {
        delta = new ArrayList<>();
        required = false;
        ReleaseProtocol.Release r = release;
        if (r == null) return;

        if (BuildConfig.VERSION_CODE < r.minAppVersionCode) required = true;
        if (r.uiMinVersion > installedUiVersion() && r.uiMinAppVersionCode <= BuildConfig.VERSION_CODE) required = true;

        if (apkUpdateAvailable()) { pendingApk = r.apk; return; }
        if (r.uiVersion <= installedUiVersion()) return;
        if (r.uiMinAppVersionCode > BuildConfig.VERSION_CODE) return; // needs a newer APK first

        File current = activeUi();
        for (ReleaseProtocol.FileSpec f : r.files) {
            File have = new File(current, f.path);
            if (have.isFile() && have.length() == f.bytes) {
                byte[] bytes = readFile(have, (int) f.bytes + 1);
                if (Codec.sameDigest(Codec.sha256(bytes), f.sha256)) continue;
            }
            if (bundledMatches(f)) continue;
            delta.add(f);
        }
    }

    /** A file identical to the one already inside the APK never needs downloading. */
    private boolean bundledMatches(ReleaseProtocol.FileSpec f) {
        try (java.io.InputStream in = ctx.getAssets().open("web/" + f.path)) {
            byte[] bytes = Codec.readLimited(in, (int) f.bytes + 1);
            return bytes.length == f.bytes && Codec.sameDigest(Codec.sha256(bytes), f.sha256);
        } catch (Exception e) {
            return false;
        }
    }

    private static byte[] readFile(File f, int limit) throws IOException {
        try (java.io.FileInputStream in = new java.io.FileInputStream(f)) { return Codec.readLimited(in, limit); }
    }

    private void maybeNotify(ReleaseProtocol.Release r) {
        long seen = prefs.getLong(K_SEEN_NEWS, 0);
        if (r.published > seen) {
            prefs.edit().putLong(K_SEEN_NEWS, r.published).apply();
            if (apkUpdateAvailable() || !delta.isEmpty()) {
                Notify.show(ctx, Notify.CH_UPDATES, Notify.ID_UPDATE,
                        "SatSeva " + r.appVersionName + " is available",
                        "Open the app to update. Only the files that changed are downloaded.");
            } else if (r.events.length() > 0) {
                Notify.show(ctx, Notify.CH_NEWS, Notify.ID_NEWS, "New from the sangat",
                        "There are new announcements in SatSeva.");
            }
        }
    }

    /* -------------------------------------------------------- interface delta */
    public void downloadUi() {
        final ReleaseProtocol.Release r = release;
        if (r == null || r.uiVersion <= installedUiVersion()) return;
        if (!busy.compareAndSet(false, true)) return;
        status = "downloading"; progress = 0; error = ""; emit();
        new Thread(new Runnable() {
            @Override public void run() {
                File stage = stagingUi(r.uiVersion);
                try {
                    deleteTree(stage);
                    if (!stage.mkdirs()) throw new IOException("Cannot create staging directory");
                    // Seed the staging tree with the current interface so unchanged
                    // files are carried forward instead of re-downloaded.
                    copyTree(activeUi(), stage);
                    List<ReleaseProtocol.FileSpec> todo = new ArrayList<>(delta);
                    long total = Math.max(1, todo.size()), done = 0;
                    for (ReleaseProtocol.FileSpec f : todo) {
                        byte[] bytes = fetchVerified(f);
                        File target = new File(stage, f.path);
                        File parent = target.getParentFile();
                        if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot create directory");
                        try (FileOutputStream out = new FileOutputStream(target)) { out.write(bytes); }
                        done++;
                        progress = (int) (done * 100 / total);
                        emit();
                    }
                    for (String path : r.remove) {
                        File gone = new File(stage, path);
                        if (gone.isFile()) gone.delete();
                    }
                    if (!new File(stage, "index.html").isFile() && !bundledHasIndex()) {
                        throw new IOException("Release has no index.html");
                    }
                    // Move the fully verified tree into place first, then switch the
                    // pointer. Either the whole release is live or none of it is.
                    int previous = prefs.getInt(K_UI_VERSION, 0);
                    File finalDir = new File(uiRoot(), "r" + r.uiVersion);
                    deleteTree(finalDir);
                    if (!stage.renameTo(finalDir)) throw new IOException("Cannot commit release");
                    prefs.edit().putInt(K_PENDING, previous)
                            .putInt(K_BOOTS, 0)
                            .putInt(K_UI_VERSION, r.uiVersion).apply();
                    pruneOldVersions(r.uiVersion, previous);
                    delta = new ArrayList<>();
                    status = "ready"; progress = 100;
                    Notify.show(ctx, Notify.CH_UPDATES, Notify.ID_UPDATE, "Update ready",
                            "Restart SatSeva to use the new interface. Your journal is untouched.");
                } catch (Exception e) {
                    deleteTree(stage);
                    error = describe(e);
                    status = "available";
                } finally {
                    busy.set(false);
                    emit();
                }
            }
        }, "satseva-download-ui").start();
    }

    private byte[] fetchVerified(ReleaseProtocol.FileSpec f) throws Exception {
        Exception last = null;
        int limit = (int) Math.min(f.bytes + 1024, 64L * 1024 * 1024);
        for (String url : f.urls) {
            try {
                byte[] bytes = Http.getMaybeSharePage(url, limit);
                if (bytes.length != f.bytes) throw new IOException("Size mismatch for " + f.path);
                if (!Codec.sameDigest(Codec.sha256(bytes), f.sha256)) throw new IOException("Digest mismatch for " + f.path);
                return bytes;
            } catch (Exception e) { last = e; }
        }
        throw last == null ? new IOException("No source for " + f.path) : last;
    }

    /** Called by the interface once it has rendered successfully. */
    public void markHealthy() {
        prefs.edit().putInt(K_BOOTS, 0).remove(K_PENDING).apply();
    }

    /**
     * If a freshly applied interface never reports healthy, step back to the
     * version that was working (or to the copy compiled into the APK).
     */
    private void rollbackIfNeeded() {
        if (!prefs.contains(K_PENDING)) return;
        int boots = prefs.getInt(K_BOOTS, 0) + 1;
        if (boots < 3) { prefs.edit().putInt(K_BOOTS, boots).apply(); return; }
        int previous = prefs.getInt(K_PENDING, 0);
        File bad = activeUi();
        prefs.edit().putInt(K_UI_VERSION, previous).remove(K_PENDING).putInt(K_BOOTS, 0).apply();
        deleteTree(bad);
    }

    public void applyUi() {
        if (listener != null) listener.onState();
    }

    /* ------------------------------------------------------------- native APK */
    public void downloadApk() {
        final ReleaseProtocol.FileSpec spec = pendingApk;
        if (spec == null) return;
        if (!busy.compareAndSet(false, true)) return;
        status = "downloading"; progress = 0; error = ""; emit();
        new Thread(new Runnable() {
            @Override public void run() {
                File out = apkFile();
                try {
                    File dir = out.getParentFile();
                    if (dir != null && !dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create cache");
                    byte[] bytes = fetchVerified(spec);
                    if (!signedByUs(bytes)) throw new IOException("Update is not signed by this app's developer");
                    File tmp = new File(out.getAbsolutePath() + ".part");
                    try (FileOutputStream fos = new FileOutputStream(tmp)) { fos.write(bytes); }
                    if (out.exists()) out.delete();
                    if (!tmp.renameTo(out)) throw new IOException("Cannot stage APK");
                    apkReady = true; status = "apkReady"; progress = 100;
                } catch (Exception e) {
                    error = describe(e);
                    status = "available";
                    if (out.exists()) out.delete();
                } finally {
                    busy.set(false); emit();
                }
            }
        }, "satseva-download-apk").start();
    }

    /**
     * An APK is only offered to the installer when its signing certificate
     * matches the certificate this app is already running under. This stops a
     * validly-signed feed from being used to sideload an unrelated package.
     */
    @SuppressWarnings("deprecation")
    private boolean signedByUs(byte[] apk) throws Exception {
        File tmp = new File(ctx.getCacheDir(), "updates/verify.apk");
        File parent = tmp.getParentFile();
        if (parent != null && !parent.isDirectory()) parent.mkdirs();
        try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(apk); }
        try {
            PackageManager pm = ctx.getPackageManager();
            int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
            PackageInfo downloaded = pm.getPackageArchiveInfo(tmp.getAbsolutePath(), flags);
            PackageInfo installed = pm.getPackageInfo(ctx.getPackageName(), flags);
            if (downloaded == null || installed == null) return false;
            if (!ctx.getPackageName().equals(downloaded.packageName)) return false;
            if (Build.VERSION.SDK_INT >= 28 && downloaded.signingInfo != null) {
                downloaded.signingInfo.getApkContentsSigners();
            }
            Signature[] a = signaturesOf(downloaded), b = signaturesOf(installed);
            if (a == null || b == null) return false;
            Set<String> mine = new HashSet<>();
            for (Signature s : b) mine.add(Codec.sha256(s.toByteArray()));
            for (Signature s : a) if (!mine.contains(Codec.sha256(s.toByteArray()))) return false;
            return true;
        } finally {
            if (tmp.exists()) tmp.delete();
        }
    }

    @SuppressWarnings("deprecation")
    private static Signature[] signaturesOf(PackageInfo info) {
        if (Build.VERSION.SDK_INT >= 28 && info.signingInfo != null) {
            return info.signingInfo.hasMultipleSigners()
                    ? info.signingInfo.getApkContentsSigners()
                    : info.signingInfo.getSigningCertificateHistory();
        }
        return info.signatures;
    }

    /* --------------------------------------------------------------- pushing */
    /**
     * Poll the public ntfy topic. This is real server-initiated messaging
     * without a Google account or Firebase project; delivery is best effort and
     * the periodic job repeats it in the background.
     */
    public void pollPush() {
        ReleaseProtocol.Release r = release;
        if (r == null || r.ntfyHost.isEmpty() || r.ntfyTopic.isEmpty()) return;
        try {
            String since = String.valueOf(prefs.getLong("pushSince", System.currentTimeMillis() / 1000 - 900));
            byte[] body = Http.get(r.ntfyHost + "/" + r.ntfyTopic + "/json?poll=1&since=" + since, 256 * 1024);
            String text = new String(body, StandardCharsets.UTF_8);
            long newest = prefs.getLong("pushSince", 0);
            for (String line : text.split("\n")) {
                if (line.trim().isEmpty()) continue;
                JSONObject o = new JSONObject(line);
                if (!"message".equals(o.optString("event"))) continue;
                long time = o.optLong("time", 0);
                if (time * 1000 <= prefs.getLong("pushAt", 0)) continue;
                if (time > newest) newest = time;
                String title = o.optString("title", "SatSeva");
                String msg = o.optString("message", "");
                Notify.show(ctx, Notify.CH_NEWS, Notify.ID_NEWS + (int) (time % 100), title, msg);
                prefs.edit().putLong("pushAt", time * 1000).apply();
                if (msg.toLowerCase(java.util.Locale.ROOT).contains("update") || o.optString("tags", "").contains("rocket")) {
                    check(false);
                }
            }
            if (newest > 0) prefs.edit().putLong("pushSince", newest).apply();
        } catch (Exception ignored) {
            // A missing push channel must never disturb the app.
        }
    }

    /* ----------------------------------------------------------------- state */
    public JSONObject stateJson() throws Exception {
        JSONObject o = new JSONObject();
        o.put("status", status);
        o.put("progress", progress);
        o.put("error", error);
        o.put("apkReady", apkReady);
        o.put("required", required);
        o.put("checked", prefs.getLong(K_CHECKED, 0));
        ReleaseProtocol.Release r = release;
        if (r != null) {
            boolean uiNewer = !delta.isEmpty();
            boolean apkNewer = apkUpdateAvailable();
            if (uiNewer || apkNewer) {
                JSONObject latest = new JSONObject();
                latest.put("versionName", apkNewer ? r.appVersionName : ("interface r" + r.uiVersion));
                latest.put("apk", apkNewer);
                latest.put("filesChanged", apkNewer ? 1 : delta.size());
                latest.put("downloadBytes", apkNewer ? (r.apk == null ? 0 : r.apk.bytes) : deltaBytes());
                o.put("latest", latest);
            }
            o.put("events", r.events);
            JSONArray notes = new JSONArray();
            JSONArray byLang = r.notes.optJSONArray(langKey());
            if (byLang == null) byLang = r.notes.optJSONArray("en");
            if (byLang != null) for (int i = 0; i < byLang.length(); i++) notes.put(byLang.get(i));
            o.put("notes", notes);
        }
        return o;
    }

    private String langKey() {
        String l = java.util.Locale.getDefault().getLanguage();
        return l.equals("hi") || l.equals("pa") ? l : "en";
    }

    private long deltaBytes() {
        long n = 0;
        for (ReleaseProtocol.FileSpec f : delta) n += f.bytes;
        return n;
    }

    private static String describe(Exception e) {
        String m = e.getMessage();
        if (m == null || m.isEmpty()) m = e.getClass().getSimpleName();
        return m.length() > 180 ? m.substring(0, 180) : m;
    }

    /* ------------------------------------------------------------ file utils */
    private static void copyTree(File from, File to) throws IOException {
        if (!from.isDirectory()) return;
        File[] kids = from.listFiles();
        if (kids == null) return;
        if (!to.isDirectory() && !to.mkdirs()) throw new IOException("Cannot create " + to);
        for (File k : kids) {
            File target = new File(to, k.getName());
            if (k.isDirectory()) copyTree(k, target);
            else java.nio.file.Files.copy(k.toPath(), target.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
    }

    private boolean bundledHasIndex() {
        try (java.io.InputStream in = ctx.getAssets().open("web/index.html")) {
            return in.available() > 0;
        } catch (Exception e) { return false; }
    }

    /** Keep only the running release and the one we could roll back to. */
    private void pruneOldVersions(int keep, int previous) {
        File[] kids = uiRoot().listFiles();
        if (kids == null) return;
        for (File k : kids) {
            String n = k.getName();
            if (n.equals("r" + keep) || n.equals("r" + previous)) continue;
            deleteTree(k);
        }
    }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteTree(k);
        }
        f.delete();
    }
}
