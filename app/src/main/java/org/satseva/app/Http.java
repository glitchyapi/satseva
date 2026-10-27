package org.satseva.app;

import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.net.ssl.HttpsURLConnection;

/**
 * Deliberately small HTTPS client.
 *
 * - HTTPS only, never downgraded on redirect.
 * - Redirects are followed manually so every hop is re-validated.
 * - Every response is size-capped before it is buffered.
 * - No cookies, no credentials, no caching of personal data (there is none).
 *
 * It also knows how to turn an OnlyFiles share page into the direct download
 * link, because that host serves an HTML landing page rather than raw bytes.
 */
public final class Http {
    private Http() {}

    private static final int CONNECT_MS = 15000;
    private static final int READ_MS = 30000;
    private static final int MAX_HOPS = 5;

    /** Returns a trimmed HTTPS URL, or "" when the value cannot be trusted. */
    public static String safeHttps(String raw) {
        if (raw == null) return "";
        String s = raw.trim();
        if (s.length() > 2000) return "";
        try {
            URL u = new URL(s);
            if (!"https".equals(u.getProtocol())) return "";
            if (u.getUserInfo() != null) return "";
            if (u.getPort() != -1 && u.getPort() != 443) return "";
            String host = u.getHost();
            if (host == null || host.isEmpty() || host.contains(" ")) return "";
            return u.toExternalForm();
        } catch (Exception e) {
            return "";
        }
    }

    public static byte[] get(String url, int limit) throws IOException {
        String current = safeHttps(url);
        if (current.isEmpty()) throw new IOException("Refusing non-HTTPS source");
        for (int hop = 0; hop < MAX_HOPS; hop++) {
            HttpsURLConnection c = (HttpsURLConnection) new URL(current).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(CONNECT_MS);
            c.setReadTimeout(READ_MS);
            c.setRequestProperty("User-Agent", "SatSeva-Updater");
            c.setRequestProperty("Accept", "*/*");
            c.setRequestProperty("Cache-Control", "no-cache");
            try {
                int code = c.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String loc = c.getHeaderField("Location");
                    String next = safeHttps(loc == null ? "" : new URL(new URL(current), loc).toExternalForm());
                    if (next.isEmpty()) throw new IOException("Unsafe redirect");
                    current = next;
                    continue;
                }
                if (code != 200) throw new IOException("HTTP " + code);
                try (InputStream in = c.getInputStream()) {
                    return Codec.readLimited(in, limit);
                }
            } finally {
                c.disconnect();
            }
        }
        throw new IOException("Too many redirects");
    }

    private static final Pattern ONLYFILES_LINK = Pattern.compile(
            "href=[\"'](https://onlyfiles\\.com/dl/[^\"']+)[\"']", Pattern.CASE_INSENSITIVE);

    /**
     * OnlyFiles share pages are HTML. Resolve the direct link, but only ever to
     * the same host, and only over HTTPS. The caller still verifies SHA-256.
     */
    public static byte[] getMaybeSharePage(String url, int limit) throws IOException {
        byte[] body = get(url, limit);
        String host = new URL(url).getHost().toLowerCase(Locale.ROOT);
        if (!host.equals("onlyfiles.com") && !host.equals("www.onlyfiles.com")) return body;
        String head = new String(body, 0, Math.min(body.length, 4096), StandardCharsets.UTF_8).trim();
        if (!head.startsWith("<")) return body; // already the raw file
        String page = new String(body, StandardCharsets.UTF_8);
        Matcher m = ONLYFILES_LINK.matcher(page);
        if (!m.find()) throw new IOException("OnlyFiles direct link not found");
        String direct = m.group(1).replace("&amp;", "&");
        return get(direct, limit);
    }

    public static String b64(byte[] data) { return Base64.encodeToString(data, Base64.NO_WRAP); }
}
