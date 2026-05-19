package ru.chaotika.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.widget.RemoteViews;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class PlannerTimelineWidgetProvider extends AppWidgetProvider {

    private static final Locale RU_LOCALE = Locale.forLanguageTag("ru-RU");

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();

        if (PlannerWidgetStorage.ACTION_COMPLETE_TASK.equals(action)) {
            handleCompleteTask(context, intent);
            return;
        }

        if (
            PlannerWidgetStorage.ACTION_REFRESH_WIDGET.equals(action) ||
            Intent.ACTION_DATE_CHANGED.equals(action) ||
            Intent.ACTION_TIMEZONE_CHANGED.equals(action)
        ) {
            PlannerWidgetUpdateDispatcher.updateAllWidgets(context);
            return;
        }

        super.onReceive(context, intent);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    @Override
    public void onAppWidgetOptionsChanged(
        Context context,
        AppWidgetManager appWidgetManager,
        int appWidgetId,
        Bundle newOptions
    ) {
        updateWidget(context, appWidgetManager, appWidgetId);
    }

    static void updateAllWidgets(Context context) {
        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, PlannerTimelineWidgetProvider.class);
        int[] appWidgetIds = appWidgetManager.getAppWidgetIds(provider);

        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    private static void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        appWidgetManager.updateAppWidget(appWidgetId, buildRemoteViews(context, appWidgetId));
        appWidgetManager.notifyAppWidgetViewDataChanged(appWidgetId, R.id.planner_timeline_task_list);
    }

    private static RemoteViews buildRemoteViews(
        Context context,
        int appWidgetId
    ) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.planner_timeline_widget);
        String todayKey = getTodayKey();
        PlannerWidgetState state = PlannerWidgetContract.resolveState(
            PlannerWidgetStorage.readSnapshot(context),
            todayKey
        );
        PlannerWidgetSnapshot snapshot = state.snapshot;

        views.setInt(
            R.id.planner_timeline_root,
            "setBackgroundResource",
            getBackgroundResource(PlannerWidgetStorage.readBackgroundOpacityPercent(context))
        );
        views.setOnClickPendingIntent(
            R.id.planner_timeline_add_button,
            PlannerWidgetProvider.createAddTaskPendingIntent(context)
        );
        views.setOnClickPendingIntent(
            R.id.planner_timeline_root,
            PlannerWidgetProvider.createOpenTodayPendingIntent(context)
        );
        views.setTextViewText(
            R.id.planner_timeline_date,
            formatDateLabel(snapshot == null ? todayKey : snapshot.dateKey)
        );

        if (state.kind == PlannerWidgetStateKind.NO_SNAPSHOT) {
            bindTimelineList(
                context,
                views,
                appWidgetId,
                context.getString(R.string.planner_widget_no_snapshot_empty)
            );
            return views;
        }

        if (state.kind == PlannerWidgetStateKind.STALE) {
            views.setTextViewText(R.id.planner_timeline_title, context.getString(R.string.planner_widget_stale_title));
            bindTimelineList(
                context,
                views,
                appWidgetId,
                context.getString(R.string.planner_widget_stale_empty)
            );
            return views;
        }

        views.setTextViewText(R.id.planner_timeline_title, context.getString(R.string.planner_timeline_widget_title));
        bindTimelineList(
            context,
            views,
            appWidgetId,
            context.getString(R.string.planner_timeline_widget_empty)
        );

        return views;
    }

    private static void bindTimelineList(
        Context context,
        RemoteViews views,
        int appWidgetId,
        String emptyText
    ) {
        views.setRemoteAdapter(
            R.id.planner_timeline_task_list,
            PlannerWidgetTaskRemoteViewsService.createTimelineIntent(context, appWidgetId)
        );
        views.setPendingIntentTemplate(
            R.id.planner_timeline_task_list,
            PlannerWidgetProvider.createCompleteTaskPendingIntentTemplate(context)
        );
        views.setEmptyView(R.id.planner_timeline_task_list, R.id.planner_timeline_empty);
        views.setTextViewText(R.id.planner_timeline_empty, emptyText);
    }

    private static void handleCompleteTask(Context context, Intent intent) {
        String taskId = intent.getStringExtra(PlannerWidgetStorage.EXTRA_WIDGET_TASK_ID);

        if (PlannerWidgetStorage.storePendingCompletedTaskId(context, taskId)) {
            PlannerWidgetStorage.markTaskCompletedInSnapshot(context, taskId);
        }

        PlannerWidgetUpdateDispatcher.updateAllWidgets(context);
    }

    private static int getBackgroundResource(int opacityPercent) {
        if (opacityPercent <= 47) {
            return R.drawable.planner_widget_background_40;
        }

        if (opacityPercent <= 62) {
            return R.drawable.planner_widget_background_55;
        }

        if (opacityPercent <= 77) {
            return R.drawable.planner_widget_background_70;
        }

        if (opacityPercent <= 92) {
            return R.drawable.planner_widget_background_85;
        }

        return R.drawable.planner_widget_background;
    }

    private static String getTodayKey() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    private static String formatDateLabel(String dateKey) {
        try {
            Date date = new SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(dateKey);

            if (date == null) {
                return dateKey;
            }

            return new SimpleDateFormat("d MMMM, EEEE", RU_LOCALE).format(date);
        } catch (ParseException exception) {
            return dateKey;
        }
    }
}
