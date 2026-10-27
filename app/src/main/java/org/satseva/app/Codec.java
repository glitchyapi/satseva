package org.satseva.app;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.zip.Deflater;
import java.util.zip.DeflaterOutputStream;
import java.util.zip.Inflater;
import java.util.zip.InflaterOutputStream;

/**
 * Compression and byte helpers.
 *
 * Raw DEFLATE at BEST_COMPRESSION is used rather than GZIP: it produces the same
 * compressed payload without the 18-byte GZIP header/trailer, and the integrity
 * job GZIP's CRC would do is already covered — far more strongly — by the
 * AES-GCM authentication tag wrapped around it.
 *
 * Compression happens BEFORE encryption. Compressing ciphertext is pointless
 * (it is indistinguishable from random), so any design that encrypts first and
 * compresses second silently stores more bytes than plain JSON plus a tag.
 */
public final class Codec {
    private Codec() {}

    public static byte[] deflate(byte[] input) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(64, input.length / 3));
        Deflater deflater = new Deflater(Deflater.BEST_COMPRESSION, true);
        try (DeflaterOutputStream dz = new DeflaterOutputStream(out, deflater, 16384, true)) {
            dz.write(input);
        } finally {
            deflater.end();
        }
        return out.toByteArray();
    }

    /** Bounded inflate: a malicious or corrupt payload cannot exhaust memory. */
    public static byte[] inflate(byte[] input, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(64, input.length * 3));
        Inflater inflater = new Inflater(true);
        try (InflaterOutputStream iz = new InflaterOutputStream(new Capped(out, limit), inflater, 16384)) {
            iz.write(input);
        } finally {
            inflater.end();
        }
        return out.toByteArray();
    }

    private static final class Capped extends OutputStream {
        private final ByteArrayOutputStream target;
        private final int limit;
        Capped(ByteArrayOutputStream target, int limit) { this.target = target; this.limit = limit; }
        @Override public void write(int b) throws IOException {
            if (target.size() + 1 > limit) throw new IOException("Decompressed payload exceeds limit");
            target.write(b);
        }
        @Override public void write(byte[] b, int off, int len) throws IOException {
            if (target.size() + len > limit) throw new IOException("Decompressed payload exceeds limit");
            target.write(b, off, len);
        }
    }

    public static byte[] readLimited(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.min(limit, 32768));
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
            if (out.size() + n > limit) throw new IOException("Stream exceeds limit");
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    public static void copyLimited(InputStream in, OutputStream out, long limit) throws IOException {
        byte[] buf = new byte[32768];
        long total = 0;
        int n;
        while ((n = in.read(buf)) > 0) {
            total += n;
            if (total > limit) throw new IOException("Download exceeds declared size");
            out.write(buf, 0, n);
        }
    }

    public static String sha256(byte[] data) {
        try {
            return hex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            int v = b & 0xff;
            sb.append(Character.forDigit(v >>> 4, 16)).append(Character.forDigit(v & 15, 16));
        }
        return sb.toString();
    }

    /** Constant-time comparison so hash checks cannot be timed. */
    public static boolean sameDigest(String a, String b) {
        if (a == null || b == null || a.length() != b.length()) return false;
        int diff = 0;
        for (int i = 0; i < a.length(); i++) diff |= Character.toLowerCase(a.charAt(i)) ^ Character.toLowerCase(b.charAt(i));
        return diff == 0;
    }
}
