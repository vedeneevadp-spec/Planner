package ru.chaotika.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class PlannerTaskNotificationReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction())) {
                PlannerTaskNotificationScheduler.restore(context);
                return;
            }
            PlannerTaskNotification entry = PlannerTaskNotificationStore.find(context, intent.getStringExtra("key"));
            if (entry == null || !entry.instanceId().equals(intent.getStringExtra("instanceId"))) return;
            if (!entry.belongsTo(PlannerWidgetAuthSessionStore.read(context))) {
                PlannerTaskNotificationStore.replace(context, entry, null);
                PlannerTaskNotifications.cancel(context, entry);
                return;
            }
            String action = intent.getAction();
            if (PlannerTaskNotifications.WAKE.equals(action)) {
                if (!PlannerTaskNotification.SNOOZED.equals(entry.state()) || entry.wakeAt() > System.currentTimeMillis()) return;
                PlannerTaskNotification next = entry.withState(PlannerTaskNotification.READY, 0);
                if (PlannerTaskNotificationStore.replace(context, entry, next)) PlannerTaskNotifications.show(context, next, false);
                return;
            }
            if (!PlannerTaskNotification.READY.equals(entry.state())) return;
            if (PlannerTaskNotifications.COMPLETE.equals(action)) {
                PlannerTaskNotification next = entry.withState(PlannerTaskNotification.PENDING, 0);
                if (PlannerTaskNotificationStore.replace(context, entry, next)) {
                    PlannerTaskNotifications.show(context, next, true);
                    PlannerTaskNotificationScheduler.scheduleJob(context);
                }
            } else if (PlannerTaskNotifications.SNOOZE.equals(action)) {
                PlannerTaskNotification next = entry.withState(PlannerTaskNotification.SNOOZED,
                    System.currentTimeMillis() + PlannerTaskNotification.SNOOZE_MILLIS);
                if (PlannerTaskNotificationStore.replace(context, entry, next)) {
                    PlannerTaskNotifications.cancel(context, entry);
                    try {
                        PlannerTaskNotificationScheduler.scheduleAlarm(context, next);
                    } catch (RuntimeException exception) {
                        // Keep the original reminder available if Android cannot schedule it.
                        if (PlannerTaskNotificationStore.replace(context, next, entry)) {
                            PlannerTaskNotifications.show(context, entry, true);
                        }
                        throw exception;
                    }
                }
            }
        } catch (RuntimeException exception) {
            android.util.Log.e("PlannerNotifications", "Notification action could not be scheduled.");
        }
    }
}
