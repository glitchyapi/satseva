package org.satseva.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import java.util.Calendar;

/**
 * The daily reminder.
 *
 * Uses an inexact repeating alarm on purpose. Exact alarms need a special
 * permission on Android 14+ and wake the device at a precise instant; a
 * reflective "note your seva" nudge does not justify either. The alarm is
 * inexact, survives reboot through BootReceiver, and is re-armed each time it
 * fires so it keeps working under Doze.
 */
public final class Reminders extends BroadcastReceiver {
    private static final String PREFS = "satseva-reminder";
    private static final int REQ = 771;

    public static void set(Context ctx, boolean on, int hour, int minute) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        p.edit().putBoolean("on", on).putInt("h", hour).putInt("m", minute).apply();
        reschedule(ctx);
    }

    public static void reschedule(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        PendingIntent pi = PendingIntent.getBroadcast(ctx, REQ, new Intent(ctx, Reminders.class),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        am.cancel(pi);
        if (!p.getBoolean("on", false)) return;
        Calendar next = Calendar.getInstance();
        next.set(Calendar.HOUR_OF_DAY, p.getInt("h", 20));
        next.set(Calendar.MINUTE, p.getInt("m", 0));
        next.set(Calendar.SECOND, 0);
        if (next.getTimeInMillis() <= System.currentTimeMillis()) next.add(Calendar.DAY_OF_YEAR, 1);
        am.setInexactRepeating(AlarmManager.RTC_WAKEUP, next.getTimeInMillis(), AlarmManager.INTERVAL_DAY, pi);
    }

    @Override public void onReceive(Context ctx, Intent intent) {
        Notify.show(ctx, Notify.CH_REMINDER, Notify.ID_REMINDER,
                "A moment for your seva",
                "Note the seva you offered today — it only takes a moment.");
        reschedule(ctx);
    }
}
