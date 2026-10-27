package org.satseva.app;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import org.json.JSONObject;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;

/**
 * The on-device journal vault.
 *
 * Pipeline: JSON -> raw DEFLATE (best) -> AES-256-GCM -> AtomicFile.
 * The AES key is generated inside AndroidKeyStore and is non-exportable; on
 * devices with a secure element it never exists in application memory at all.
 * A fixed additional-authenticated-data string binds a ciphertext to this app
 * and format version, so a blob copied from elsewhere cannot be replayed here.
 *
 * File layout: "SSV2" | flags(1) | IV(12) | ciphertext+tag
 * flags bit 0 = payload is deflated.
 */
public final class Vault {
    private static final Object LOCK = new Object();
    private static final String ALIAS = "satseva-journal-v2";
    private static final byte[] MAGIC = {'S', 'S', 'V', '2'};
    private static final byte[] AAD = "satseva-local-v2".getBytes(StandardCharsets.UTF_8);
    private static final int MAX_PLAIN = 8 * 1024 * 1024;
    private static final int MAX_BLOB = 12 * 1024 * 1024;

    private final AtomicFile file;
    private volatile int rawBytes, compressedBytes, storedBytes;

    public Vault(Context context) {
        file = new AtomicFile(new File(context.getFilesDir(), "journal.vault"));
    }

    private SecretKey key(boolean createIfMissing) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        if (!createIfMissing) throw new Exception("Vault key unavailable");
        // Refuse to mint a fresh key over an existing journal: that would turn a
        // recoverable situation into silent, permanent data loss.
        if (exists()) throw new Exception("Vault key is missing but a journal exists");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    private boolean exists() {
        return file.getBaseFile().exists() || new File(file.getBaseFile() + ".bak").exists();
    }

    /** Returns the decrypted journal JSON, or null when nothing is stored yet. */
    public String load() throws Exception {
        synchronized (LOCK) {
            if (!exists()) return null;
            byte[] blob;
            try (java.io.FileInputStream in = file.openRead()) {
                blob = Codec.readLimited(in, MAX_BLOB);
            }
            if (blob.length < 17) throw new Exception("Truncated vault");
            for (int i = 0; i < 4; i++) if (blob[i] != MAGIC[i]) throw new Exception("Unrecognised vault");
            boolean zipped = (blob[4] & 1) != 0;
            byte[] iv = Arrays.copyOfRange(blob, 5, 17);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(false), new GCMParameterSpec(128, iv));
            cipher.updateAAD(AAD);
            byte[] plain = cipher.doFinal(blob, 17, blob.length - 17);
            byte[] json;
            try {
                json = zipped ? Codec.inflate(plain, MAX_PLAIN) : plain;
            } finally {
                if (zipped) Arrays.fill(plain, (byte) 0);
            }
            try {
                String text = new String(json, StandardCharsets.UTF_8);
                StateValidator.parse(text);
                rawBytes = json.length;
                compressedBytes = plain.length;
                storedBytes = blob.length;
                return text;
            } finally {
                Arrays.fill(json, (byte) 0);
            }
        }
    }

    public void save(String json) throws Exception {
        synchronized (LOCK) {
            StateValidator.parse(json);
            byte[] utf8 = json.getBytes(StandardCharsets.UTF_8);
            byte[] packed = Codec.deflate(utf8);
            boolean zipped = packed.length < utf8.length;
            byte[] payload = zipped ? packed : utf8;
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key(true));
            cipher.updateAAD(AAD);
            byte[] encrypted;
            try {
                encrypted = cipher.doFinal(payload);
            } finally {
                Arrays.fill(utf8, (byte) 0);
                Arrays.fill(packed, (byte) 0);
            }
            FileOutputStream out = null;
            try {
                out = file.startWrite();
                out.write(MAGIC);
                out.write(zipped ? 1 : 0);
                out.write(cipher.getIV());
                out.write(encrypted);
                file.finishWrite(out);
                rawBytes = json.getBytes(StandardCharsets.UTF_8).length;
                compressedBytes = payload.length;
                storedBytes = 17 + encrypted.length;
            } catch (Exception e) {
                if (out != null) file.failWrite(out);
                throw e;
            }
        }
    }

    /** Explicit restore. Only ever called after the user confirms replacement. */
    public void restore(String json) throws Exception {
        synchronized (LOCK) {
            StateValidator.parse(json);
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (!store.containsAlias(ALIAS)) {
                KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
                g.init(new KeyGenParameterSpec.Builder(ALIAS,
                        KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                        .setKeySize(256).build());
                g.generateKey();
            }
            save(json);
        }
    }

    public JSONObject stats() throws Exception {
        JSONObject o = new JSONObject();
        if (rawBytes == 0 && exists()) {
            storedBytes = (int) file.getBaseFile().length();
        }
        o.put("raw", rawBytes);
        o.put("compressed", compressedBytes);
        o.put("stored", storedBytes);
        return o;
    }
}
