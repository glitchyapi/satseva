package satseva.test;

import org.json.JSONObject;
import org.satseva.app.Codec;
import org.satseva.app.ReleaseProtocol;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.util.Arrays;
import java.util.Base64;
import java.util.Random;

/**
 * Runs the real production classes on a desktop JVM.
 *
 * The point is to prove the trust chain end to end: a feed signed by the Python
 * publisher (and by the browser admin console, which emits raw r||s) must verify
 * with the exact Java code that ships inside the APK, and a tampered document
 * must not.
 */
public final class CoreTests {
    private static int passed = 0, failed = 0;

    private static void check(String name, boolean ok) {
        System.out.println((ok ? "  PASS  " : "  FAIL  ") + name);
        if (ok) passed++; else failed++;
    }

    public static void main(String[] args) throws Exception {
        Path root = Paths.get(args.length > 0 ? args[0] : ".");

        /* ---- compression: the claim on the storage screen must be real ---- */
        StringBuilder sb = new StringBuilder("{\"entries\":[");
        for (int i = 0; i < 400; i++) {
            if (i > 0) sb.append(',');
            sb.append("{\"id\":\"e").append(i).append("\",\"cat\":\"naam\",\"title\":\"Morning naam jaap\",")
              .append("\"minutes\":45,\"date\":\"2026-10-27\",\"place\":\"Satlok Ashram\",\"note\":\"\"}");
        }
        sb.append("]}");
        byte[] plain = sb.toString().getBytes(StandardCharsets.UTF_8);
        byte[] packed = Codec.deflate(plain);
        byte[] back = Codec.inflate(packed, 8 * 1024 * 1024);
        check("deflate/inflate round trip is byte-exact", Arrays.equals(plain, back));
        check("deflate is materially smaller (" + plain.length + " -> " + packed.length + ")", packed.length < plain.length / 3);
        boolean bounded = false;
        try {
            Codec.inflate(packed, 16);
        } catch (Exception e) { bounded = true; }
        check("inflate refuses to exceed its output cap", bounded);

        /* ---- digest comparison ---- */
        check("sha256 is stable", Codec.sha256(plain).equals(Codec.sha256(plain.clone())));
        check("digest compare is case-insensitive", Codec.sameDigest(Codec.sha256(plain), Codec.sha256(plain).toUpperCase()));
        check("different bytes give different digest", !Codec.sameDigest(Codec.sha256(plain), Codec.sha256(packed)));

        /* ---- path safety: nothing may escape the interface directory ---- */
        String[] bad = {"../evil", "/etc/passwd", "a/../../b", "..", "a\\b", "a\u0000b", "C:/x", "", "./a", "a//b"};
        boolean allBlocked = true;
        for (String p : bad) if (ReleaseProtocol.safePath(p)) { allBlocked = false; System.out.println("    leaked: " + p); }
        check("path traversal and absolute paths are rejected", allBlocked);
        check("normal nested asset path is accepted", ReleaseProtocol.safePath("assets/hero-diya.webp"));

        /* ---- the real signed feed produced by scripts/publish.py ---- */
        Path feed = root.resolve("docs/updates/stable.json");
        Path sig = root.resolve("docs/updates/stable.json.sig");
        Path pub = root.resolve("app/src/main/assets/update-public.der");
        if (Files.exists(feed) && Files.exists(sig) && Files.exists(pub)) {
            byte[] doc = Files.readAllBytes(feed);
            byte[] signature = Base64.getDecoder().decode(new String(Files.readAllBytes(sig), StandardCharsets.UTF_8).trim());
            ReleaseProtocol protocol = new ReleaseProtocol(new ByteArrayInputStream(Files.readAllBytes(pub)));
            check("publisher signature verifies with the shipped public key", protocol.verify(doc, signature));

            byte[] tampered = new String(doc, StandardCharsets.UTF_8).replace("\"versionCode\": 1", "\"versionCode\": 999").getBytes(StandardCharsets.UTF_8);
            check("tampered document is rejected", !protocol.verify(tampered, signature));
            byte[] flipped = signature.clone();
            flipped[10] ^= 0x01;
            check("tampered signature is rejected", !protocol.verify(doc, flipped));

            ReleaseProtocol.Release r = protocol.parse(doc);
            check("feed parses", r.uiVersion >= 1 && !r.files.isEmpty());
            boolean digestsOk = true;
            for (ReleaseProtocol.FileSpec f : r.files) {
                Path local = root.resolve("web").resolve(f.path);
                if (!Files.exists(local)) { digestsOk = false; continue; }
                byte[] bytes = Files.readAllBytes(local);
                if (bytes.length != f.bytes || !Codec.sameDigest(Codec.sha256(bytes), f.sha256)) digestsOk = false;
            }
            check("every advertised file digest matches the working tree", digestsOk);
            boolean httpsOnly = true;
            for (ReleaseProtocol.FileSpec f : r.files) for (String u : f.urls) if (!u.startsWith("https://")) httpsOnly = false;
            check("every file source is HTTPS", httpsOnly);
        } else {
            System.out.println("  SKIP  live feed tests (run scripts/publish.py first)");
        }

        /* ---- raw r||s signatures, which is what WebCrypto produces ---- */
        KeyPairGenerator gen = KeyPairGenerator.getInstance("EC");
        gen.initialize(new ECGenParameterSpec("secp256r1"));
        KeyPair pair = gen.generateKeyPair();
        Path tmpKey = Files.createTempFile("satseva-test-key", ".der");
        Files.write(tmpKey, pair.getPublic().getEncoded());
        ReleaseProtocol p2 = new ReleaseProtocol(new ByteArrayInputStream(Files.readAllBytes(tmpKey)));
        byte[] message = "satseva".getBytes(StandardCharsets.UTF_8);
        Signature signer = Signature.getInstance("SHA256withECDSA");
        signer.initSign(pair.getPrivate());
        signer.update(message);
        byte[] der = signer.sign();
        check("DER signature verifies", p2.verify(message, der));
        check("raw r||s signature verifies (browser admin console)", p2.verify(message, derToRaw(der)));
        check("wrong message is rejected", !p2.verify("other".getBytes(StandardCharsets.UTF_8), der));
        Files.deleteIfExists(tmpKey);

        /* ---- HTTPS gate ---- */
        check("http:// is refused", org.satseva.app.Http.safeHttps("http://example.com/a").isEmpty());
        check("credentials in URL are refused", org.satseva.app.Http.safeHttps("https://user:pass@example.com/a").isEmpty());
        check("odd port is refused", org.satseva.app.Http.safeHttps("https://example.com:8080/a").isEmpty());
        check("plain HTTPS passes", !org.satseva.app.Http.safeHttps("https://example.com/a").isEmpty());

        System.out.println("\n" + passed + " passed, " + failed + " failed");
        if (failed > 0) System.exit(1);
    }

    private static byte[] derToRaw(byte[] der) {
        int idx = 2;
        if (der[3] == 0) idx = 4;
        int rLen = der[idx + 1];
        byte[] r = Arrays.copyOfRange(der, idx + 2, idx + 2 + rLen);
        int sIdx = idx + 2 + rLen;
        int sLen = der[sIdx + 1];
        byte[] s = Arrays.copyOfRange(der, sIdx + 2, sIdx + 2 + sLen);
        byte[] out = new byte[64];
        System.arraycopy(r, Math.max(0, rLen - 32), out, Math.max(0, 32 - rLen), Math.min(32, rLen));
        System.arraycopy(s, Math.max(0, sLen - 32), out, 32 + Math.max(0, 32 - sLen), Math.min(32, sLen));
        return out;
    }
}
