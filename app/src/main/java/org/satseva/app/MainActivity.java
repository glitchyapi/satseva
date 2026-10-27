package org.satseva.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * One activity, one WebView, one native bridge.
 *
 * The interface is served from an intercepted HTTPS origin (never file://), all
 * navigation away from that origin is blocked, and the only JavaScript surface
 * exposed is the explicit @JavascriptInterface methods below. Personal data
 * crosses the bridge in one direction only: into the encrypted vault.
 */
public final class MainActivity extends Activity implements UpdateManager.Listener {

    private static final int REQ_NOTIF = 31;
    private static final int REQ_EXPORT = 32;
    private static final int REQ_IMPORT = 33;
    private static final int REQ_SAVE_BANNER = 34;

    private WebView web;
    private Vault vault;
    private UpdateManager updates;
    private LocalResourceServer server;
    private byte[] pendingExport;
    private String pendingExportName;

    @SuppressLint("SetJavaScriptEnabled")
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.parseColor("#F7F4EE"));
        getWindow().setNavigationBarColor(Color.parseColor("#F7F4EE"));
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        vault = new Vault(this);
        try {
            updates = SatSevaApp.updates(this);
            updates.setListener(this);
        } catch (Exception e) {
            Toast.makeText(this, "Update engine unavailable", Toast.LENGTH_LONG).show();
        }
        server = new LocalResourceServer(this, updates);

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setGeolocationEnabled(false);
        s.setSavePassword(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        web.setBackgroundColor(Color.parseColor("#F7F4EE"));
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.addJavascriptInterface(new Bridge(), "SatSevaNative");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return block(request.getUrl());
            }
            @SuppressWarnings("deprecation")
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return block(Uri.parse(url));
            }
            private boolean block(Uri uri) {
                return !(LocalResourceServer.HOST.equals(uri.getHost()) && "https".equals(uri.getScheme()));
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (LocalResourceServer.HOST.equals(uri.getHost())) return server.serve(uri.getPath());
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked",
                        new java.util.HashMap<String, String>(),
                        new java.io.ByteArrayInputStream(new byte[0]));
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) {
                    Toast.makeText(MainActivity.this, "Interface could not load; restoring bundled version", Toast.LENGTH_LONG).show();
                }
            }
        });
        web.setWebChromeClient(new android.webkit.WebChromeClient());
        if (Build.VERSION.SDK_INT >= 26) {
            web.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }
        web.loadUrl(LocalResourceServer.ENTRY);

        Notify.init(this);
        UpdateJob.schedule(this);
        Reminders.reschedule(this);
    }

    /* ------------------------------------------------------------ lifecycle */
    @Override protected void onResume() {
        super.onResume();
        if (web != null) { web.onResume(); web.resumeTimers(); }
        if (updates != null) updates.setListener(this);
    }

    @Override protected void onPause() {
        if (web != null) web.onPause();
        super.onPause();
    }

    @Override protected void onDestroy() {
        if (updates != null) updates.setListener(null);
        if (web != null) { web.removeJavascriptInterface("SatSevaNative"); web.destroy(); }
        super.onDestroy();
    }

    @Override public void onBackPressed() {
        if (web == null) { super.onBackPressed(); return; }
        web.evaluateJavascript("window.SatSevaBack ? window.SatSevaBack() : false", new android.webkit.ValueCallback<String>() {
            @Override public void onReceiveValue(String value) {
                if (!"true".equals(value)) MainActivity.super.onBackPressed();
            }
        });
    }

    @Override public void onState() {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                if (web == null) return;
                web.evaluateJavascript("window.SatSevaEvent && window.SatSevaEvent('updateState','{}')", null);
            }
        });
    }

    private void emitOnUiThread(final String name, final String payload) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                if (web == null) return;
                web.evaluateJavascript("window.SatSevaEvent && window.SatSevaEvent("
                        + JSONObject.quote(name) + "," + JSONObject.quote(payload) + ")", null);
            }
        });
    }

    /* --------------------------------------------------------------- bridge */
    private final class Bridge {
        @JavascriptInterface public String loadVault() {
            try { String s = vault.load(); return s == null ? "" : s; }
            catch (Exception e) { return ""; }
        }

        @JavascriptInterface public String saveVault(String json) {
            try { vault.save(json); return "ok"; }
            catch (Exception e) { return "error: " + e.getMessage(); }
        }

        @JavascriptInterface public String vaultStats() {
            try { return vault.stats().toString(); }
            catch (Exception e) { return "{}"; }
        }

        @JavascriptInterface public String getInfo() {
            JSONObject o = new JSONObject();
            try {
                o.put("native", true);
                o.put("versionName", BuildConfig.VERSION_NAME);
                o.put("versionCode", BuildConfig.VERSION_CODE);
                o.put("uiVersion", updates == null ? BuildConfig.UI_VERSION : updates.installedUiVersion());
                o.put("androidRelease", Build.VERSION.RELEASE);
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("notifications", Notify.allowed(MainActivity.this));
                o.put("install", canInstall());
                o.put("mirrors", updates == null ? "" : android.text.TextUtils.join(" · ", updates.feedUrls()));
            } catch (Exception ignored) { }
            return o.toString();
        }

        @JavascriptInterface public String updateState() {
            try { return updates == null ? "{}" : updates.stateJson().toString(); }
            catch (Exception e) { return "{}"; }
        }

        @JavascriptInterface public void markHealthy() { if (updates != null) updates.markHealthy(); }
        @JavascriptInterface public void checkUpdates(boolean force) { if (updates != null) updates.check(force); }
        @JavascriptInterface public void downloadUi() { if (updates != null) updates.downloadUi(); }
        @JavascriptInterface public void downloadApk() { if (updates != null) updates.downloadApk(); }
        @JavascriptInterface public void setAutoUpdate(boolean on) { if (updates != null) updates.setAutoUpdate(on); }

        @JavascriptInterface public void applyUi() {
            runOnUiThread(new Runnable() {
                @Override public void run() { if (web != null) web.loadUrl(LocalResourceServer.ENTRY); }
            });
        }

        @JavascriptInterface public void installApk() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    File apk = updates == null ? null : updates.apkFile();
                    if (apk == null || !apk.isFile()) { toast("No verified update is ready"); return; }
                    if (!canInstall()) {
                        toast("Allow installing from SatSeva, then tap Install again");
                        openInstallSettings();
                        return;
                    }
                    Uri uri = Uri.parse("content://" + ShareProvider.AUTHORITY + "/update/release.apk");
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(uri, "application/vnd.android.package-archive");
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    try { startActivity(i); }
                    catch (Exception e) { toast("Android could not open the installer"); }
                }
            });
        }

        @JavascriptInterface public void requestNotifications() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    if (Build.VERSION.SDK_INT >= 33) {
                        requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIF);
                    } else {
                        openNotificationSettings();
                    }
                }
            });
        }

        @JavascriptInterface public void openNotificationSettings() {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try { startActivity(i); } catch (Exception e) { appSettings(); }
        }

        @JavascriptInterface public void openInstallSettings() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    if (Build.VERSION.SDK_INT >= 26) {
                        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        try { startActivity(i); return; } catch (Exception ignored) { }
                    }
                    appSettings();
                }
            });
        }

        @JavascriptInterface public void setReminder(boolean on, int hour, int minute) {
            Reminders.set(MainActivity.this, on, Math.max(0, Math.min(23, hour)), Math.max(0, Math.min(59, minute)));
            if (on && !Notify.allowed(MainActivity.this)) requestNotifications();
        }

        @JavascriptInterface public void exportBackup(final String name, final String base64) {
            try {
                pendingExport = Base64.decode(base64, Base64.NO_WRAP);
                pendingExportName = sanitiseName(name, ".seva");
            } catch (Exception e) { toast("Backup could not be prepared"); return; }
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("application/octet-stream");
                    i.putExtra(Intent.EXTRA_TITLE, pendingExportName);
                    try { startActivityForResult(i, REQ_EXPORT); }
                    catch (Exception e) { toast("No file picker available"); }
                }
            });
        }

        @JavascriptInterface public void importBackup() {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType("*/*");
                    try { startActivityForResult(i, REQ_IMPORT); }
                    catch (Exception e) { toast("No file picker available"); }
                }
            });
        }

        @JavascriptInterface public void saveBanner(final String name, final String base64) {
            final byte[] png;
            try { png = Base64.decode(base64, Base64.NO_WRAP); }
            catch (Exception e) { toast("Image could not be read"); return; }
            final String clean = sanitiseName(name, ".png");
            if (Build.VERSION.SDK_INT >= 29) {
                new Thread(new Runnable() {
                    @Override public void run() {
                        try {
                            ContentValues cv = new ContentValues();
                            cv.put(MediaStore.Images.Media.DISPLAY_NAME, clean);
                            cv.put(MediaStore.Images.Media.MIME_TYPE, "image/png");
                            cv.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/SatSeva");
                            cv.put(MediaStore.Images.Media.IS_PENDING, 1);
                            Uri uri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
                            if (uri == null) throw new Exception("MediaStore refused the image");
                            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                                if (out == null) throw new Exception("Cannot open gallery stream");
                                out.write(png);
                            }
                            cv.clear();
                            cv.put(MediaStore.Images.Media.IS_PENDING, 0);
                            getContentResolver().update(uri, cv, null, null);
                            toast("Saved to Pictures/SatSeva");
                        } catch (Exception e) {
                            saveBannerViaPicker(clean, png);
                        }
                    }
                }, "satseva-save-banner").start();
            } else {
                saveBannerViaPicker(clean, png);
            }
        }

        @JavascriptInterface public void shareBanner(String name, String base64, String text) {
            try {
                byte[] png = Base64.decode(base64, Base64.NO_WRAP);
                File dir = new File(getCacheDir(), "share");
                if (!dir.isDirectory() && !dir.mkdirs()) throw new Exception("Cannot create share cache");
                File[] old = dir.listFiles();
                if (old != null) for (File f : old) f.delete();
                final String clean = sanitiseName(name, ".png");
                File f = new File(dir, clean);
                try (FileOutputStream out = new FileOutputStream(f)) { out.write(png); }
                Uri uri = Uri.parse("content://" + ShareProvider.AUTHORITY + "/share/" + clean);
                final Intent i = new Intent(Intent.ACTION_SEND);
                i.setType("image/png");
                i.putExtra(Intent.EXTRA_STREAM, uri);
                i.putExtra(Intent.EXTRA_TEXT, text);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        try { startActivity(Intent.createChooser(i, "Share banner")); }
                        catch (Exception e) { toast("No app available to share"); }
                    }
                });
            } catch (Exception e) { toast("Banner could not be shared"); }
        }

        @JavascriptInterface public void shareText(final String text) {
            runOnUiThread(new Runnable() {
                @Override public void run() {
                    Intent i = new Intent(Intent.ACTION_SEND);
                    i.setType("text/plain");
                    i.putExtra(Intent.EXTRA_TEXT, text);
                    try { startActivity(Intent.createChooser(i, "Share")); }
                    catch (Exception e) { toast("No app available to share"); }
                }
            });
        }
    }

    /* ------------------------------------------------------------- helpers */
    private boolean canInstall() {
        return Build.VERSION.SDK_INT < 26 || getPackageManager().canRequestPackageInstalls();
    }

    private void appSettings() {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { startActivity(i); } catch (Exception ignored) { }
    }

    private void saveBannerViaPicker(final String name, final byte[] png) {
        pendingExport = png;
        pendingExportName = name;
        runOnUiThread(new Runnable() {
            @Override public void run() {
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("image/png");
                i.putExtra(Intent.EXTRA_TITLE, name);
                try { startActivityForResult(i, REQ_SAVE_BANNER); }
                catch (Exception e) { toast("No file picker available"); }
            }
        });
    }

    private static String sanitiseName(String name, String fallbackExt) {
        String clean = name == null ? "" : name.replaceAll("[^A-Za-z0-9._-]", "_");
        if (clean.isEmpty() || clean.length() > 80) clean = "SatSeva" + fallbackExt;
        if (!clean.contains(".")) clean += fallbackExt;
        return clean;
    }

    private void toast(final String message) {
        runOnUiThread(new Runnable() {
            @Override public void run() { Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show(); }
        });
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIF) emitOnUiThread("info", "{}");
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            pendingExport = null;
            return;
        }
        Uri uri = data.getData();
        try {
            if (requestCode == REQ_EXPORT || requestCode == REQ_SAVE_BANNER) {
                byte[] bytes = pendingExport;
                pendingExport = null;
                if (bytes == null) return;
                try (OutputStream out = getContentResolver().openOutputStream(uri, "w")) {
                    if (out == null) throw new Exception("Cannot write to the chosen location");
                    out.write(bytes);
                }
                toast(requestCode == REQ_EXPORT ? "Backup saved" : "Banner saved");
            } else if (requestCode == REQ_IMPORT) {
                byte[] bytes;
                try (InputStream in = getContentResolver().openInputStream(uri)) {
                    if (in == null) throw new Exception("Cannot read the chosen file");
                    bytes = Codec.readLimited(in, 16 * 1024 * 1024);
                }
                final String payload = Base64.encodeToString(bytes, Base64.NO_WRAP);
                runOnUiThread(new Runnable() {
                    @Override public void run() {
                        if (web != null) web.evaluateJavascript(
                                "window.SatSevaBackupPicked && window.SatSevaBackupPicked(" + JSONObject.quote(payload) + ")", null);
                    }
                });
            }
        } catch (Exception e) {
            toast("File operation failed");
        }
    }
}
