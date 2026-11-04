package ru.chaotika.app;

import android.content.Context;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;

final class PlannerTaskNotificationStore {
    private static final String KEY = "planner.task-notifications.v1";
    private static final String LEGACY_GROUP = "CapacitorStorage";
    private static final long RETENTION_MILLIS = 30L * 24 * 60 * 60_000;

    private PlannerTaskNotificationStore() {}

    static synchronized List<PlannerTaskNotification> read(Context context) {
        String raw = PlannerSecureStorage.getString(context, KEY, LEGACY_GROUP);
        List<PlannerTaskNotification> result = new ArrayList<>();
        if (raw == null) return result;
        try {
            JSONArray values = new JSONArray(raw);
            for (int i = 0; i < values.length(); i++) {
                PlannerTaskNotification entry = PlannerTaskNotification.parse(values.getJSONObject(i).toString());
                if (entry != null && System.currentTimeMillis() - entry.createdAt() < RETENTION_MILLIS) result.add(entry);
            }
            return result;
        } catch (JSONException exception) {
            throw new IllegalStateException("Invalid notification action storage.", exception);
        }
    }

    static synchronized PlannerTaskNotification find(Context context, String key) {
        for (PlannerTaskNotification entry : read(context)) if (entry.key().equals(key)) return entry;
        return null;
    }

    static synchronized boolean receive(Context context, PlannerTaskNotification entry) {
        List<PlannerTaskNotification> entries = read(context);
        for (PlannerTaskNotification existing : entries) {
            if (existing.key().equals(entry.key()) &&
                (PlannerTaskNotification.PENDING.equals(existing.state()) || PlannerTaskNotification.SNOOZED.equals(existing.state()) ||
                 (!entry.notificationTag().isEmpty() && entry.notificationTag().equals(existing.notificationTag())))) return false;
        }
        entries.removeIf(existing -> existing.key().equals(entry.key()));
        entries.add(entry);
        write(context, entries);
        return true;
    }

    static synchronized boolean replace(Context context, PlannerTaskNotification expected, PlannerTaskNotification next) {
        List<PlannerTaskNotification> entries = read(context);
        for (int i = 0; i < entries.size(); i++) {
            PlannerTaskNotification current = entries.get(i);
            if (!current.key().equals(expected.key()) || !current.instanceId().equals(expected.instanceId()) ||
                !current.state().equals(expected.state())) continue;
            if (next == null) entries.remove(i); else entries.set(i, next);
            write(context, entries);
            return true;
        }
        return false;
    }

    static synchronized void clear(Context context) {
        if (!PlannerSecureStorage.remove(context, KEY, LEGACY_GROUP)) throw new IllegalStateException("Failed to clear notification actions.");
    }

    private static void write(Context context, List<PlannerTaskNotification> entries) {
        JSONArray values = new JSONArray();
        for (PlannerTaskNotification entry : entries) values.put(entry.toJson());
        if (!PlannerSecureStorage.putString(context, KEY, values.toString(), LEGACY_GROUP)) {
            throw new IllegalStateException("Failed to persist notification action.");
        }
    }
}
