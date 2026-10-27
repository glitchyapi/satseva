package org.satseva.app;

import android.app.Application;
import android.content.Context;

/** Lazily creates the single update manager shared by the activity and the job. */
public final class SatSevaApp extends Application {
    private static volatile UpdateManager manager;
    private static final Object LOCK = new Object();

    @Override public void onCreate() {
        super.onCreate();
        Notify.init(this);
    }

    public static UpdateManager updates(Context ctx) throws Exception {
        if (manager == null) {
            synchronized (LOCK) {
                if (manager == null) manager = new UpdateManager(ctx.getApplicationContext());
            }
        }
        return manager;
    }
}
