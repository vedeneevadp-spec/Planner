package ru.chaotika.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.NotificationCompat;

final class PlannerTaskNotifications {
    static final String COMPLETE = "ru.chaotika.app.notification.COMPLETE";
    static final String SNOOZE = "ru.chaotika.app.notification.SNOOZE";
    static final String WAKE = "ru.chaotika.app.notification.WAKE";
    private static final String CHANNEL = "chaotika-general";

    private PlannerTaskNotifications() {}

    static void notifyTaskChanged() {
        com.getcapacitor.Bridge bridge = com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin.staticBridge;
        if (bridge != null) bridge.triggerWindowJSEvent("planner:task-notification-completed");
    }

    static void show(Context context, PlannerTaskNotification entry, boolean silent) {
        show(context, entry, silent, true);
    }

    static void showBasic(Context context, PlannerTaskNotification entry) {
        show(context, entry, false, false);
    }

    private static void show(Context context, PlannerTaskNotification entry, boolean silent, boolean actionable) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Chaotika", NotificationManager.IMPORTANCE_HIGH));
        }
        boolean pending = PlannerTaskNotification.PENDING.equals(entry.state());
        boolean error = PlannerTaskNotification.ERROR.equals(entry.state());
        String body = pending
            ? entry.taskTitle() + "\nСохраняем выполнение. Без связи отправим позже."
            : error ? entry.taskTitle() + "\nНе удалось отметить. Откройте задачу для проверки."
            : entry.body();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_chaotika)
            .setContentTitle(pending ? "Сохраняем выполнение" : entry.title())
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(openTask(context, entry))
            .setAutoCancel(!pending)
            .setOnlyAlertOnce(silent)
            .setSilent(silent)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER);
        if (actionable && !pending && !error) {
            builder.addAction(android.R.drawable.checkbox_on_background, "Готово", actionIntent(context, entry, COMPLETE));
            builder.addAction(android.R.drawable.ic_menu_recent_history, "Через 15 минут", actionIntent(context, entry, SNOOZE));
        }
        try { manager.notify(tag(entry), 1, builder.build()); }
        catch (SecurityException ignored) { /* Notifications were disabled in system settings. */ }
    }

    static void cancel(Context context, PlannerTaskNotification entry) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.cancel(tag(entry), 1);
        PlannerTaskNotificationScheduler.cancelAlarm(context, entry);
    }

    static void clearAll(Context context) {
        for (PlannerTaskNotification entry : PlannerTaskNotificationStore.read(context)) cancel(context, entry);
        PlannerTaskNotificationStore.clear(context);
        PlannerTaskNotificationScheduler.cancelJob(context);
    }

    static PendingIntent actionIntent(Context context, PlannerTaskNotification entry, String action) {
        Intent intent = new Intent(context, PlannerTaskNotificationReceiver.class)
            .setAction(action)
            .setData(Uri.parse("chaotika://task-notification/" + Uri.encode(action) + "/" + Uri.encode(entry.key())))
            .putExtra("key", entry.key())
            .putExtra("instanceId", entry.instanceId());
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent openTask(Context context, PlannerTaskNotification entry) {
        Intent intent = new Intent(context, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .setData(Uri.parse("chaotika://task/" + Uri.encode(entry.key())))
            .putExtra("google.message_id", entry.instanceId())
            .putExtra("type", "task-reminder")
            .putExtra("path", "/today")
            .putExtra("taskId", entry.taskId())
            .putExtra("workspaceId", entry.workspaceId());
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static String tag(PlannerTaskNotification entry) { return "planner-task:" + entry.key(); }
}
