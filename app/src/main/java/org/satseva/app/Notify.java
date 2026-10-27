package org.satseva.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

/** Two quiet channels: one for releases, one for the daily reminder. */
public final class Notify {
    public static final String CH_UPDATES = "satseva-updates";
    public static final String CH_REMINDER = "satseva-reminder";
    public static final int ID_UPDATE = 1001;
    public static final int ID_REMINDER = 1002;
    public static final int ID_NEWS = 1003;

    private Notify() {}

    public static void init(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel updates = new NotificationChannel(CH_UPDATES, "App updates", NotificationManager.IMPORTANCE_DEFAULT);
        updates.setDescription("New versions of SatSeva");
        nm.createNotificationChannel(updates);
        NotificationChannel news = new NotificationChannel(CH_NEWS, "Sangat announcements", NotificationManager.IMPORTANCE_DEFAULT);
        news.setDescription("Bhandara and community announcements");
        nm.createNotificationChannel(news);
        NotificationChannel reminder = new NotificationChannel(CH_REMINDER, "Daily reminder", NotificationManager.IMPORTANCE_LOW);
        reminder.setDescription("A gentle nudge to note your seva");
        reminder.setShowBadge(false);
        nm.createNotificationChannel(reminder);
    }

    public static final String CH_NEWS = "satseva-news";

    public static boolean allowed(Context c) {
        if (Build.VERSION.SDK_INT >= 33) {
            return c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        return nm == null || nm.areNotificationsEnabled();
    }

    private static PendingIntent open(Context c, int req) {
        Intent i = new Intent(c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static void show(Context c, String channel, int id, String title, String body) {
        if (!allowed(c)) return;
        init(c);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(c, channel)
                : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_stat)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(open(c, id))
                .setColor(0xFFD9762A);
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm != null) nm.notify(id, b.build());
    }
}
