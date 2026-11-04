package ru.chaotika.app;

import android.content.Context;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public class PlannerMessagingService extends MessagingService {
    @Override
    public void onMessageReceived(RemoteMessage message) {
        if (!"1".equals(message.getData().get("actionsVersion"))) {
            super.onMessageReceived(message);
            return;
        }
        renderTaskReminder(this, message.getData());
    }

    static void renderTaskReminder(Context context, Map<String, String> data) {
        try {
            PlannerWidgetSyncConfig config = PlannerWidgetStorage.readSyncConfig(context);
            PlannerTaskNotification entry = PlannerTaskNotification.fromPush(
                data, config == null ? "" : config.apiBaseUrl
            );
            if (entry == null || !entry.belongsTo(PlannerWidgetAuthSessionStore.read(context))) return;
            try {
                if (PlannerTaskNotificationStore.receive(context, entry)) PlannerTaskNotifications.show(context, entry, false);
            } catch (RuntimeException exception) {
                // Keep the reminder visible even if durable action storage is unavailable.
                PlannerTaskNotifications.showBasic(context, entry);
            }
        } catch (RuntimeException exception) {
            // No payloads or authentication data in logs.
            android.util.Log.e("PlannerNotifications", "Could not persist task notification.");
        }
    }
}
