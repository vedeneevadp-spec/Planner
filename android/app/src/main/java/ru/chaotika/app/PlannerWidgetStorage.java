package ru.chaotika.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.TimeZone;

final class PlannerWidgetStorage {

    static final String ACTION_COMPLETE_TASK = "ru.chaotika.app.action.COMPLETE_TASK_FROM_WIDGET";
    static final String ACTION_CYCLE_BACKGROUND_OPACITY = "ru.chaotika.app.action.CYCLE_WIDGET_BACKGROUND_OPACITY";
    static final String ACTION_OPEN_TODAY = "ru.chaotika.app.action.OPEN_TODAY_FROM_WIDGET";
    static final String ACTION_REFRESH_WIDGET = "ru.chaotika.app.action.REFRESH_WIDGET";
    static final String EXTRA_WIDGET_TASK_ID = "ru.chaotika.app.extra.WIDGET_TASK_ID";
    static final String EXTRA_WIDGET_ROUTE = "ru.chaotika.app.extra.WIDGET_ROUTE";
    static final String SNAPSHOT_KEY = "planner.widget.today.snapshot";
    static final String TODAY_ROUTE = "/today";

    private static final int DEFAULT_BACKGROUND_OPACITY_PERCENT = 85;
    private static final String BACKGROUND_OPACITY_KEY = "planner.widget.background.opacityPercent";
    private static final String PENDING_COMPLETED_TASK_IDS_KEY = "planner.widget.pending-completed-task-ids";
    private static final String PENDING_ROUTE_KEY = "planner.widget.pending-route";
    private static final String PREFERENCES_NAME = "CapacitorStorage";

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
        SharedPreferences preferences = getPreferences(context);
        Set<String> taskIds = preferences.getStringSet(PENDING_COMPLETED_TASK_IDS_KEY, Collections.emptySet());
        List<String> pendingTaskIds = new ArrayList<>();

        for (String taskId : taskIds) {
            if (isSupportedTaskId(taskId)) {
                pendingTaskIds.add(taskId);
            }
        }

        if (!taskIds.isEmpty()) {
            preferences.edit().remove(PENDING_COMPLETED_TASK_IDS_KEY).apply();
        }

        return pendingTaskIds;
    }

    static String readSnapshot(Context context) {
        return getPreferences(context).getString(SNAPSHOT_KEY, null);
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

    static int cycleBackgroundOpacityPercent(Context context) {
        int nextOpacity = getNextBackgroundOpacityPercent(readBackgroundOpacityPercent(context));

        getPreferences(context).edit().putString(BACKGROUND_OPACITY_KEY, String.valueOf(nextOpacity)).apply();

        return nextOpacity;
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

    private static int getNextBackgroundOpacityPercent(int value) {
        if (value >= 100) {
            return 85;
        }

        if (value >= 85) {
            return 70;
        }

        if (value >= 70) {
            return 55;
        }

        if (value >= 55) {
            return 40;
        }

        return 100;
    }

    private static String formatUtcNow() {
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));

        return formatter.format(new Date());
    }
}
