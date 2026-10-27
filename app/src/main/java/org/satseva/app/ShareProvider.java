package org.satseva.app;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;

/**
 * A deliberately narrow, read-only file window.
 *
 * Only two things can ever be handed to another app: the verified update APK
 * and a banner the user just chose to share. The journal vault lives in
 * getFilesDir() and is not reachable through this provider at all, so granting
 * a URI permission can never leak personal data.
 */
public final class ShareProvider extends ContentProvider {
    public static final String AUTHORITY = "org.satseva.app.files";

    @Override public boolean onCreate() { return true; }

    private File resolve(Uri uri) throws FileNotFoundException {
        if (!AUTHORITY.equals(uri.getAuthority())) throw new FileNotFoundException("Unknown authority");
        String path = uri.getPath();
        if (path == null) throw new FileNotFoundException("No path");
        File base;
        String name;
        if (path.startsWith("/update/")) {
            base = new File(getContext().getCacheDir(), "updates");
            name = path.substring("/update/".length());
            if (!"release.apk".equals(name)) throw new FileNotFoundException("Not permitted");
        } else if (path.startsWith("/share/")) {
            base = new File(getContext().getCacheDir(), "share");
            name = path.substring("/share/".length());
            if (!ReleaseProtocol.safePath(name) || name.contains("/")) throw new FileNotFoundException("Not permitted");
        } else {
            throw new FileNotFoundException("Not permitted");
        }
        File f = new File(base, name);
        if (!f.isFile()) throw new FileNotFoundException("No such file");
        return f;
    }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new FileNotFoundException("Read only");
        return ParcelFileDescriptor.open(resolve(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public String getType(Uri uri) {
        String p = String.valueOf(uri.getPath());
        return p.endsWith(".apk") ? "application/vnd.android.package-archive" : "image/png";
    }

    @Override public Cursor query(Uri uri, String[] projection, String sel, String[] args, String sort) {
        try {
            File f = resolve(uri);
            String[] columns = projection == null
                    ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
            MatrixCursor cursor = new MatrixCursor(columns);
            Object[] row = new Object[columns.length];
            for (int i = 0; i < columns.length; i++) {
                if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) row[i] = f.getName();
                else if (OpenableColumns.SIZE.equals(columns[i])) row[i] = f.length();
                else row[i] = null;
            }
            cursor.addRow(row);
            return cursor;
        } catch (Exception e) { return null; }
    }

    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Read only"); }
    @Override public int delete(Uri uri, String sel, String[] args) { throw new UnsupportedOperationException("Read only"); }
    @Override public int update(Uri uri, ContentValues values, String sel, String[] args) { throw new UnsupportedOperationException("Read only"); }
}
