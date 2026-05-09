package ru.chaotika.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

final class PlannerWidgetStorage {

    static final String ACTION_OPEN_TODAY = "ru.chaotika.app.action.OPEN_TODAY_FROM_WIDGET";
    static final String EXTRA_WIDGET_ROUTE = "ru.chaotika.app.extra.WIDGET_ROUTE";
    static final String SNAPSHOT_KEY = "planner.widget.today.snapshot";
    static final String TODAY_ROUTE = "/today";

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

    static String readSnapshot(Context context) {
        return getPreferences(context).getString(SNAPSHOT_KEY, null);
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
}
