package org.satseva.app;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.os.PersistableBundle;

/**
 * Background maintenance: check the signed feed and drain the public push topic.
 *
 * JobScheduler is used rather than a foreground service: there is no persistent
 * notification, no wake lock held by this app, and Android is free to batch the
 * work with everything else on the device. 15 minutes is the platform minimum
 * for periodic jobs, so that is the honest worst-case alert latency.
 */
public final class UpdateJob extends JobService {
    private static final int JOB_ID = 4207;

    public static void schedule(Context ctx) {
        JobScheduler scheduler = (JobScheduler) ctx.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (scheduler == null) return;
        JobInfo.Builder b = new JobInfo.Builder(JOB_ID, new ComponentName(ctx, UpdateJob.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPersisted(true)
                .setPeriodic(15 * 60 * 1000, 5 * 60 * 1000)
                .setBackoffCriteria(60 * 1000, JobInfo.BACKOFF_POLICY_EXPONENTIAL);
        PersistableBundle extras = new PersistableBundle();
        extras.putBoolean("push", true);
        b.setExtras(extras);
        scheduler.schedule(b.build());
    }

    @Override public boolean onStartJob(final JobParameters params) {
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    UpdateManager manager = SatSevaApp.updates(getApplicationContext());
                    manager.pollPush();
                    manager.check(false);
                } catch (Exception ignored) {
                } finally {
                    jobFinished(params, false);
                }
            }
        }, "satseva-job").start();
        return true;
    }

    @Override public boolean onStopJob(JobParameters params) { return true; }
}
