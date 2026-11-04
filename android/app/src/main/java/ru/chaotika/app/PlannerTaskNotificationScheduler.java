package ru.chaotika.app;

import android.app.AlarmManager;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;

final class PlannerTaskNotificationScheduler {
    static final int JOB_ID = 0x504c03;

    private PlannerTaskNotificationScheduler() {}

    static void scheduleJob(Context context) {
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler == null) throw new IllegalStateException("JobScheduler is unavailable.");
        // Reschedule even if a job is finishing, so a newly queued tap cannot be
        // stranded between that job's final queue check and jobFinished().
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, PlannerTaskNotificationJobService.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .setOverrideDeadline(0)
            .setBackoffCriteria(30_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
            .build();
        if (scheduler.schedule(job) != JobScheduler.RESULT_SUCCESS) throw new IllegalStateException("Notification action scheduling failed.");
    }

    static void scheduleAlarm(Context context, PlannerTaskNotification entry) {
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        if (manager == null) throw new IllegalStateException("AlarmManager is unavailable.");
        // A reminder is not an alarm clock: no additional exact-alarm permission.
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, entry.wakeAt(),
            PlannerTaskNotifications.actionIntent(context, entry, PlannerTaskNotifications.WAKE));
    }

    static void cancelAlarm(Context context, PlannerTaskNotification entry) {
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        if (manager != null) manager.cancel(PlannerTaskNotifications.actionIntent(context, entry, PlannerTaskNotifications.WAKE));
    }

    static void cancelJob(Context context) {
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler != null) scheduler.cancel(JOB_ID);
    }

    static void restore(Context context) {
        PlannerWidgetAuthSession session = PlannerWidgetAuthSessionStore.read(context);
        for (PlannerTaskNotification entry : PlannerTaskNotificationStore.read(context)) {
            if (!entry.belongsTo(session)) {
                PlannerTaskNotificationStore.replace(context, entry, null);
                PlannerTaskNotifications.cancel(context, entry);
            } else if (PlannerTaskNotification.PENDING.equals(entry.state())) scheduleJob(context);
            else if (PlannerTaskNotification.SNOOZED.equals(entry.state())) scheduleAlarm(context, entry);
        }
    }
}
