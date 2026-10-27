package org.satseva.app;

import android.content.Context;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Serves the interface from a real HTTPS origin instead of file://.
 *
 * file:// would force us to enable universal file access, disable the same
 * origin policy and give up meaningful CSP. Serving through an intercepted
 * https origin keeps the WebView sandbox intact while still being fully
 * offline: no socket is opened, the bytes come from the applied update
 * directory or, for files it does not contain, from the APK's own assets.
 */
public final class LocalResourceServer {
    public static final String HOST = "appassets.androidplatform.net";
    public static final String ORIGIN = "https://" + HOST;
    public static final String ENTRY = ORIGIN + "/assets/index.html";

    private final Context ctx;
    private final UpdateManager updates;

    public LocalResourceServer(Context ctx, UpdateManager updates) {
        this.ctx = ctx;
        this.updates = updates;
    }

    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html");
        MIME.put("js", "application/javascript");
        MIME.put("css", "text/css");
        MIME.put("json", "application/json");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("webp", "image/webp");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("gif", "image/gif");
        MIME.put("woff2", "font/woff2");
        MIME.put("woff", "font/woff");
        MIME.put("txt", "text/plain");
    }

    public WebResourceResponse serve(String path) {
        String rel = path.startsWith("/assets/") ? path.substring("/assets/".length()) : "";
        if (rel.isEmpty()) rel = "index.html";
        int q = rel.indexOf('?');
        if (q >= 0) rel = rel.substring(0, q);
        if (!ReleaseProtocol.safePath(rel)) return notFound();
        String ext = rel.contains(".") ? rel.substring(rel.lastIndexOf('.') + 1).toLowerCase(java.util.Locale.ROOT) : "";
        String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
        try {
            File live = new File(updates.activeUi(), rel);
            if (live.isFile() && live.getCanonicalPath().startsWith(updates.activeUi().getCanonicalPath() + File.separator)) {
                return respond(mime, new FileInputStream(live));
            }
        } catch (Exception ignored) { }
        try {
            return respond(mime, ctx.getAssets().open("web/" + rel));
        } catch (Exception ignored) { }
        return notFound();
    }

    private static WebResourceResponse respond(String mime, InputStream in) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", ORIGIN);
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, in);
    }

    private static WebResourceResponse notFound() {
        Map<String, String> headers = new HashMap<>();
        headers.put("X-Content-Type-Options", "nosniff");
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", headers,
                new ByteArrayInputStream("not found".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }
}
