package ru.chaotika.app;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;

final class PlannerWidgetSyncScheduler {

    static final int IMMEDIATE_JOB_ID = 0x504c02;
    static final int PERIODIC_JOB_ID = 0x504c01;
    static final long PERIODIC_INTERVAL_MILLIS = 15 * 60_000L;

    private PlannerWidgetSyncScheduler() {}

    static void schedule(Context context, boolean includeImmediate) {
        Context appContext = context.getApplicationContext();

        if (
            PlannerWidgetStorage.readSyncConfig(appContext) == null ||
            !hasAnyWidgets(appContext)
        ) {
            cancel(appContext);
            return;
        }

        JobScheduler scheduler = getScheduler(appContext);

        if (scheduler == null) {
            return;
        }

        ComponentName service = new ComponentName(appContext, PlannerWidgetSyncJobService.class);
        JobInfo periodicJob = new JobInfo.Builder(PERIODIC_JOB_ID, service)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .setPeriodic(PERIODIC_INTERVAL_MILLIS)
            .build();

        scheduler.schedule(periodicJob);

        if (includeImmediate) {
            JobInfo immediateJob = new JobInfo.Builder(IMMEDIATE_JOB_ID, service)
                .setBackoffCriteria(30_000L, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                .setMinimumLatency(0L)
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .build();

            scheduler.schedule(immediateJob);
        }
    }

    static void scheduleImmediate(Context context) {
        schedule(context, true);
    }

    static void cancelIfUnused(Context context) {
        if (!hasAnyWidgets(context)) {
            cancel(context);
        }
    }

    static void cancel(Context context) {
        JobScheduler scheduler = getScheduler(context.getApplicationContext());

        if (scheduler != null) {
            scheduler.cancel(IMMEDIATE_JOB_ID);
            scheduler.cancel(PERIODIC_JOB_ID);
        }
    }

    static boolean hasAnyWidgets(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);

        return hasWidgets(manager, context, PlannerWidgetProvider.class) ||
            hasWidgets(manager, context, PlannerTimelineWidgetProvider.class);
    }

    private static boolean hasWidgets(
        AppWidgetManager manager,
        Context context,
        Class<?> providerClass
    ) {
        return manager.getAppWidgetIds(new ComponentName(context, providerClass)).length > 0;
    }

    private static JobScheduler getScheduler(Context context) {
        return (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
    }
}
