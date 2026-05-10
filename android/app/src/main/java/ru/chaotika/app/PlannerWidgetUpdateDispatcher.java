package ru.chaotika.app;

import android.content.Context;

final class PlannerWidgetUpdateDispatcher {

    private PlannerWidgetUpdateDispatcher() {}

    static void updateAllWidgets(Context context) {
        PlannerWidgetProvider.updateAllWidgets(context);
        PlannerTimelineWidgetProvider.updateAllWidgets(context);
    }
}
