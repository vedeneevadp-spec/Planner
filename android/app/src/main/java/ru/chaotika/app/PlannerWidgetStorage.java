package ru.chaotika.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;
import org.json.JSONException;
import org.json.JSONObject;

final class PlannerWidgetStorage {

    private static final String SYNC_LOG_TAG = "PlannerWidgetSync";

    static final String ACTION_COMPLETE_TASK = "ru.chaotika.app.action.COMPLETE_TASK_FROM_WIDGET";
    static final String ACTION_ADD_TASK = "ru.chaotika.app.action.ADD_TASK_FROM_WIDGET";
    static final String ACTION_OPEN_TODAY = "ru.chaotika.app.action.OPEN_TODAY_FROM_WIDGET";
    static final String ACTION_REFRESH_WIDGET = "ru.chaotika.app.action.REFRESH_WIDGET";
    static final String EXTRA_WIDGET_TASK_ID = "ru.chaotika.app.extra.WIDGET_TASK_ID";
    static final String EXTRA_WIDGET_ROUTE = "ru.chaotika.app.extra.WIDGET_ROUTE";
    static final String SNAPSHOT_KEY = "planner.widget.today.snapshot";
    static final String ADD_TASK_ROUTE = "/today?createTask=widget";
    static final String TODAY_ROUTE = "/today";

    private static final int DEFAULT_BACKGROUND_OPACITY_PERCENT = 85;
    private static final String BACKGROUND_OPACITY_KEY = "planner.widget.background.opacityPercent";
    private static final String READ_ONLY_KEY = "planner.widget.read-only";
    private static final String SHOW_CLEANING_KEY = "planner.widget.show-cleaning";
    private static final String SHOW_SELF_CARE_KEY = "planner.widget.show-self-care";
    private static final String PENDING_COMPLETED_TASK_IDS_KEY = "planner.widget.pending-completed-task-ids";
    private static final String PENDING_ROUTE_KEY = "planner.widget.pending-route";
    private static final String PREFERENCES_NAME = "CapacitorStorage";
    private static final String SYNC_CONFIG_KEY = "planner.widget.sync.config";
    private static final String SYNC_LAST_ATTEMPT_AT_KEY = "planner.widget.sync.last-attempt-at";
    private static final String SYNC_LAST_ERROR_KEY = "planner.widget.sync.last-error";
    private static final String SYNC_LAST_SUCCESS_AT_KEY = "planner.widget.sync.last-success-at";

    private PlannerWidgetStorage() {}

    static String consumePendingRoute(Context context) {
        SharedPreferences preferences = getPreferences(context);
        String route = preferences.getString(PENDING_ROUTE_KEY, null);

        if (route != null) {
            preferences.edit().remove(PENDING_ROUTE_KEY).apply();
        }

        return isSupportedRoute(route) ? route : null;
    }

    static List<String> consumePendingCompletedTaskIds(Context context) {
        List<String> pendingTaskIds = readPendingCompletedTaskIds(context);

        removePendingCompletedTaskIds(context, pendingTaskIds);

        return pendingTaskIds;
    }

    static List<String> readPendingCompletedTaskIds(Context context) {
        SharedPreferences preferences = getPreferences(context);
        Set<String> taskIds = preferences.getStringSet(PENDING_COMPLETED_TASK_IDS_KEY, Collections.emptySet());
        List<String> pendingTaskIds = new ArrayList<>();

        for (String taskId : taskIds) {
            if (isSupportedTaskId(taskId)) {
                pendingTaskIds.add(taskId);
            }
        }

        return pendingTaskIds;
    }

    static void removePendingCompletedTaskIds(Context context, List<String> completedTaskIds) {
        if (completedTaskIds == null || completedTaskIds.isEmpty()) {
            return;
        }

        SharedPreferences preferences = getPreferences(context);
        Set<String> storedTaskIds = preferences.getStringSet(PENDING_COMPLETED_TASK_IDS_KEY, Collections.emptySet());
        Set<String> nextTaskIds = new LinkedHashSet<>(storedTaskIds);

        for (String taskId : completedTaskIds) {
            if (isSupportedTaskId(taskId)) {
                nextTaskIds.remove(taskId);
            }
        }

        if (nextTaskIds.size() == storedTaskIds.size()) {
            return;
        }

        SharedPreferences.Editor editor = preferences.edit();

        if (nextTaskIds.isEmpty()) {
            editor.remove(PENDING_COMPLETED_TASK_IDS_KEY);
        } else {
            editor.putStringSet(PENDING_COMPLETED_TASK_IDS_KEY, nextTaskIds);
        }

        editor.apply();
    }

    static String readSnapshot(Context context) {
        return getPreferences(context).getString(SNAPSHOT_KEY, null);
    }

    static boolean writeSnapshot(Context context, String snapshot) {
        if (PlannerWidgetContract.parseSnapshot(snapshot) == null) {
            return false;
        }

        return getPreferences(context).edit().putString(SNAPSHOT_KEY, snapshot).commit();
    }

    static PlannerWidgetSyncConfig readSyncConfig(Context context) {
        return PlannerWidgetSyncConfig.parse(
            getPreferences(context).getString(SYNC_CONFIG_KEY, null)
        );
    }

    static boolean writeSyncConfig(Context context, PlannerWidgetSyncConfig config) {
        if (config == null) {
            return false;
        }

        return getPreferences(context)
            .edit()
            .putString(SYNC_CONFIG_KEY, config.toJson().toString())
            .commit();
    }

    static boolean clearSyncConfig(Context context) {
        return getPreferences(context).edit().remove(SYNC_CONFIG_KEY).commit();
    }

    static void recordSyncAttempt(Context context) {
        getPreferences(context)
            .edit()
            .putString(SYNC_LAST_ATTEMPT_AT_KEY, formatUtcNow())
            .apply();
    }

    static void recordSyncFailure(Context context, String errorKind) {
        String normalizedErrorKind = errorKind == null ? "unknown" : errorKind;

        getPreferences(context)
            .edit()
            .putString(SYNC_LAST_ERROR_KEY, normalizedErrorKind)
            .apply();
        Log.w(SYNC_LOG_TAG, "Background widget sync failure: " + normalizedErrorKind);
    }

    static void recordSyncSuccess(Context context) {
        getPreferences(context)
            .edit()
            .putString(SYNC_LAST_SUCCESS_AT_KEY, formatUtcNow())
            .remove(SYNC_LAST_ERROR_KEY)
            .apply();
    }

    static int readBackgroundOpacityPercent(Context context) {
        String value = getPreferences(context).getString(BACKGROUND_OPACITY_KEY, null);

        if (value == null) {
            return DEFAULT_BACKGROUND_OPACITY_PERCENT;
        }

        try {
            return normalizeBackgroundOpacityPercent(Integer.parseInt(value));
        } catch (NumberFormatException exception) {
            return DEFAULT_BACKGROUND_OPACITY_PERCENT;
        }
    }

    static PlannerWidgetConfiguration readConfiguration(Context context) {
        SharedPreferences preferences = getPreferences(context);

        return new PlannerWidgetConfiguration(
            readBackgroundOpacityPercent(preferences),
            preferences.getBoolean(READ_ONLY_KEY, false),
            preferences.getBoolean(SHOW_SELF_CARE_KEY, false),
            preferences.getBoolean(SHOW_CLEANING_KEY, false)
        );
    }

    static int writeBackgroundOpacityPercent(Context context, int value) {
        int opacity = normalizeBackgroundOpacityPercent(value);

        getPreferences(context).edit().putString(BACKGROUND_OPACITY_KEY, String.valueOf(opacity)).apply();

        return opacity;
    }

    static PlannerWidgetConfiguration writeConfiguration(
        Context context,
        int backgroundOpacityPercent,
        boolean readOnly,
        boolean showSelfCare,
        boolean showCleaning
    ) {
        int opacity = normalizeBackgroundOpacityPercent(backgroundOpacityPercent);

        getPreferences(context)
            .edit()
            .putString(BACKGROUND_OPACITY_KEY, String.valueOf(opacity))
            .putBoolean(READ_ONLY_KEY, readOnly)
            .putBoolean(SHOW_SELF_CARE_KEY, showSelfCare)
            .putBoolean(SHOW_CLEANING_KEY, showCleaning)
            .apply();

        return new PlannerWidgetConfiguration(opacity, readOnly, showSelfCare, showCleaning);
    }

    static void markTaskCompletedInSnapshot(Context context, String taskId) {
        SharedPreferences preferences = getPreferences(context);
        String nextSnapshot = PlannerWidgetContract.markTaskDone(
            preferences.getString(SNAPSHOT_KEY, null),
            taskId,
            formatUtcNow()
        );

        if (nextSnapshot != null) {
            preferences.edit().putString(SNAPSHOT_KEY, nextSnapshot).apply();
        }
    }

    static boolean storePendingCompletedTaskId(Context context, String taskId) {
        if (!isSupportedTaskId(taskId)) {
            return false;
        }

        SharedPreferences preferences = getPreferences(context);
        Set<String> pendingTaskIds = new LinkedHashSet<>(
            preferences.getStringSet(PENDING_COMPLETED_TASK_IDS_KEY, Collections.emptySet())
        );

        pendingTaskIds.add(taskId);
        preferences.edit().putStringSet(PENDING_COMPLETED_TASK_IDS_KEY, pendingTaskIds).apply();

        return true;
    }

    static void storePendingRouteFromIntent(Context context, Intent intent) {
        if (intent == null) {
            return;
        }

        String route = intent.getStringExtra(EXTRA_WIDGET_ROUTE);

        if (!isSupportedRoute(route)) {
            return;
        }

        getPreferences(context).edit().putString(PENDING_ROUTE_KEY, route).apply();
    }

    private static SharedPreferences getPreferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    private static int readBackgroundOpacityPercent(SharedPreferences preferences) {
        String value = preferences.getString(BACKGROUND_OPACITY_KEY, null);

        if (value == null) {
            return DEFAULT_BACKGROUND_OPACITY_PERCENT;
        }

        try {
            return normalizeBackgroundOpacityPercent(Integer.parseInt(value));
        } catch (NumberFormatException exception) {
            return DEFAULT_BACKGROUND_OPACITY_PERCENT;
        }
    }

    private static boolean isSupportedRoute(String route) {
        return route != null && route.startsWith("/") && !route.startsWith("//");
    }

    private static boolean isSupportedTaskId(String taskId) {
        return taskId != null && !taskId.trim().isEmpty();
    }

    private static int normalizeBackgroundOpacityPercent(int value) {
        if (value <= 47) {
            return 40;
        }

        if (value <= 62) {
            return 55;
        }

        if (value <= 77) {
            return 70;
        }

        if (value <= 92) {
            return 85;
        }

        return 100;
    }

    private static String formatUtcNow() {
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));

        return formatter.format(new Date());
    }
}

final class PlannerWidgetSyncConfig {
    private static final int VERSION = 1;

    final String apiBaseUrl;
    final String timeZone;
    final String workspaceId;

    PlannerWidgetSyncConfig(String apiBaseUrl, String workspaceId, String timeZone) {
        this.apiBaseUrl = normalizeBaseUrl(apiBaseUrl);
        this.workspaceId = workspaceId == null ? "" : workspaceId.trim();
        this.timeZone = timeZone == null ? "" : timeZone.trim();
    }

    boolean isValid() {
        return (
            (apiBaseUrl.startsWith("https://") || apiBaseUrl.startsWith("http://")) &&
            !workspaceId.isEmpty() &&
            !timeZone.isEmpty()
        );
    }

    JSONObject toJson() {
        JSONObject value = new JSONObject();

        try {
            value.put("apiBaseUrl", apiBaseUrl);
            value.put("timeZone", timeZone);
            value.put("version", VERSION);
            value.put("workspaceId", workspaceId);
        } catch (JSONException exception) {
            throw new IllegalStateException("Failed to serialize widget sync config.", exception);
        }

        return value;
    }

    static PlannerWidgetSyncConfig parse(String rawValue) {
        if (rawValue == null || rawValue.trim().isEmpty()) {
            return null;
        }

        try {
            JSONObject value = new JSONObject(rawValue);

            if (value.optInt("version", 0) != VERSION) {
                return null;
            }

            PlannerWidgetSyncConfig config = new PlannerWidgetSyncConfig(
                value.optString("apiBaseUrl", ""),
                value.optString("workspaceId", ""),
                value.optString("timeZone", "")
            );

            return config.isValid() ? config : null;
        } catch (JSONException exception) {
            return null;
        }
    }

    private static String normalizeBaseUrl(String value) {
        String normalized = value == null ? "" : value.trim();

        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }

        return normalized;
    }
}

final class PlannerWidgetConfiguration {
    final int backgroundOpacityPercent;
    final boolean readOnly;
    final boolean showCleaning;
    final boolean showSelfCare;

    PlannerWidgetConfiguration(
        int backgroundOpacityPercent,
        boolean readOnly,
        boolean showSelfCare,
        boolean showCleaning
    ) {
        this.backgroundOpacityPercent = backgroundOpacityPercent;
        this.readOnly = readOnly;
        this.showSelfCare = showSelfCare;
        this.showCleaning = showCleaning;
    }
}
