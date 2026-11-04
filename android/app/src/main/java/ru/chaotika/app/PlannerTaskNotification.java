package ru.chaotika.app;

import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

/** Durable, account-scoped task reminder. Never contains credentials. */
final class PlannerTaskNotification {
    static final String READY = "ready";
    static final String PENDING = "pending";
    static final String SNOOZED = "snoozed";
    static final String ERROR = "error";
    static final long SNOOZE_MILLIS = 15 * 60_000L;
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9][A-Za-z0-9_-]{0,127}");
    private final JSONObject value;

    private PlannerTaskNotification(JSONObject value) { this.value = value; }

    static PlannerTaskNotification fromPush(Map<String, String> data, String apiBaseUrl) {
        if (!"task-reminder".equals(data.get("type")) || !"1".equals(data.get("actionsVersion"))) return null;
        try {
            JSONObject value = new JSONObject();
            for (String key : new String[] {"taskId", "workspaceId", "recipientUserId", "title", "body", "taskTitle", "notificationTag"}) {
                value.put(key, data.get(key));
            }
            value.put("apiBaseUrl", apiBaseUrl);
            value.put("instanceId", UUID.randomUUID().toString());
            value.put("state", READY);
            value.put("createdAt", System.currentTimeMillis());
            return parse(value.toString());
        } catch (JSONException exception) { return null; }
    }

    static PlannerTaskNotification parse(String raw) {
        if (raw == null) return null;
        try {
            JSONObject value = new JSONObject(raw);
            for (String key : new String[] {"taskId", "workspaceId", "recipientUserId", "instanceId"}) {
                if (!ID.matcher(value.optString(key, "")).matches()) return null;
            }
            String state = value.optString("state", "");
            if (!READY.equals(state) && !PENDING.equals(state) && !SNOOZED.equals(state) && !ERROR.equals(state)) return null;
            if (value.optString("title", "").isEmpty() || value.optLong("createdAt", 0) <= 0) return null;
            return new PlannerTaskNotification(value);
        } catch (JSONException exception) { return null; }
    }

    String key() { return userId() + ":" + workspaceId() + ":" + taskId(); }
    String taskId() { return value.optString("taskId"); }
    String workspaceId() { return value.optString("workspaceId"); }
    String userId() { return value.optString("recipientUserId"); }
    String instanceId() { return value.optString("instanceId"); }
    String apiBaseUrl() { return value.optString("apiBaseUrl"); }
    String title() { return value.optString("title"); }
    String body() { return value.optString("body"); }
    String taskTitle() { return value.optString("taskTitle", body()); }
    String state() { return value.optString("state"); }
    String notificationTag() { return value.optString("notificationTag"); }
    long wakeAt() { return value.optLong("wakeAt", 0); }
    long createdAt() { return value.optLong("createdAt"); }
    int expectedVersion() { return value.optInt("expectedVersion", 0); }
    JSONObject toJson() {
        try { return new JSONObject(value.toString()); }
        catch (JSONException exception) { throw new IllegalStateException(exception); }
    }

    PlannerTaskNotification withState(String state, long wakeAt) {
        JSONObject next = toJson();
        try {
            next.put("state", state);
            next.put("wakeAt", wakeAt);
            if (READY.equals(state)) {
                next.put("title", "Напоминание");
                next.put("body", taskTitle());
            }
            return parse(next.toString());
        } catch (JSONException exception) { throw new IllegalStateException(exception); }
    }

    PlannerTaskNotification withExpectedVersion(int version) {
        JSONObject next = toJson();
        try {
            next.put("expectedVersion", version);
            return parse(next.toString());
        } catch (JSONException exception) { throw new IllegalStateException(exception); }
    }

    boolean belongsTo(PlannerWidgetAuthSession session) {
        return session != null && userId().equals(session.userId);
    }
}
