package ru.chaotika.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class PlannerTimelineWidgetProvider extends AppWidgetProvider {

    private static final int DEFAULT_WIDGET_HEIGHT_DP = 220;
    private static final int MAX_TIMELINE_TASKS = 8;
    private static final Locale RU_LOCALE = Locale.forLanguageTag("ru-RU");
    private static final int[] TIMELINE_ROW_IDS = {
        R.id.planner_timeline_task_row_1,
        R.id.planner_timeline_task_row_2,
        R.id.planner_timeline_task_row_3,
        R.id.planner_timeline_task_row_4,
        R.id.planner_timeline_task_row_5,
        R.id.planner_timeline_task_row_6,
        R.id.planner_timeline_task_row_7,
        R.id.planner_timeline_task_row_8,
    };
    private static final int[] TIMELINE_ICON_IDS = {
        R.id.planner_timeline_task_icon_1,
        R.id.planner_timeline_task_icon_2,
        R.id.planner_timeline_task_icon_3,
        R.id.planner_timeline_task_icon_4,
        R.id.planner_timeline_task_icon_5,
        R.id.planner_timeline_task_icon_6,
        R.id.planner_timeline_task_icon_7,
        R.id.planner_timeline_task_icon_8,
    };
    private static final int[] TIMELINE_TIME_IDS = {
        R.id.planner_timeline_task_time_1,
        R.id.planner_timeline_task_time_2,
        R.id.planner_timeline_task_time_3,
        R.id.planner_timeline_task_time_4,
        R.id.planner_timeline_task_time_5,
        R.id.planner_timeline_task_time_6,
        R.id.planner_timeline_task_time_7,
        R.id.planner_timeline_task_time_8,
    };
    private static final int[] TIMELINE_TITLE_IDS = {
        R.id.planner_timeline_task_title_1,
        R.id.planner_timeline_task_title_2,
        R.id.planner_timeline_task_title_3,
        R.id.planner_timeline_task_title_4,
        R.id.planner_timeline_task_title_5,
        R.id.planner_timeline_task_title_6,
        R.id.planner_timeline_task_title_7,
        R.id.planner_timeline_task_title_8,
    };
    private static final int[] TIMELINE_CHECKBOX_IDS = {
        R.id.planner_timeline_task_checkbox_1,
        R.id.planner_timeline_task_checkbox_2,
        R.id.planner_timeline_task_checkbox_3,
        R.id.planner_timeline_task_checkbox_4,
        R.id.planner_timeline_task_checkbox_5,
        R.id.planner_timeline_task_checkbox_6,
        R.id.planner_timeline_task_checkbox_7,
        R.id.planner_timeline_task_checkbox_8,
    };

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

    static void updateAllWidgets(Context context) {
        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, PlannerTimelineWidgetProvider.class);
        int[] appWidgetIds = appWidgetManager.getAppWidgetIds(provider);

        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    private static void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        appWidgetManager.updateAppWidget(appWidgetId, buildRemoteViews(context, appWidgetManager, appWidgetId));
    }

    private static RemoteViews buildRemoteViews(
        Context context,
        AppWidgetManager appWidgetManager,
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
            bindTimelineRows(
                context,
                views,
                new ArrayList<>(),
                context.getString(R.string.planner_widget_no_snapshot_empty),
                getTaskLimit(appWidgetManager, appWidgetId)
            );
            return views;
        }

        if (state.kind == PlannerWidgetStateKind.STALE) {
            views.setTextViewText(R.id.planner_timeline_title, context.getString(R.string.planner_widget_stale_title));
            bindTimelineRows(
                context,
                views,
                new ArrayList<>(),
                context.getString(R.string.planner_widget_stale_empty),
                getTaskLimit(appWidgetManager, appWidgetId)
            );
            return views;
        }

        views.setTextViewText(R.id.planner_timeline_title, context.getString(R.string.planner_timeline_widget_title));
        bindTimelineRows(
            context,
            views,
            getTimelineTasks(snapshot.tasks),
            context.getString(R.string.planner_timeline_widget_empty),
            getTaskLimit(appWidgetManager, appWidgetId)
        );

        return views;
    }

    private static void bindTimelineRows(
        Context context,
        RemoteViews views,
        List<PlannerWidgetTask> tasks,
        String emptyText,
        int taskLimit
    ) {
        int visibleTaskCount = Math.min(tasks.size(), taskLimit);

        for (int rowId : TIMELINE_ROW_IDS) {
            views.setViewVisibility(rowId, View.GONE);
        }

        for (int index = 0; index < visibleTaskCount; index += 1) {
            PlannerWidgetTask task = tasks.get(index);
            int rowId = TIMELINE_ROW_IDS[index];
            int checkboxId = TIMELINE_CHECKBOX_IDS[index];
            int accentColor = PlannerWidgetVisuals.getTaskAccentColor(context, task);

            views.setImageViewBitmap(
                TIMELINE_ICON_IDS[index],
                PlannerWidgetVisuals.createTaskIconBitmap(context, task)
            );
            views.setImageViewBitmap(
                checkboxId,
                PlannerWidgetVisuals.createCheckboxBitmap(context, accentColor)
            );
            views.setTextViewText(
                TIMELINE_TIME_IDS[index],
                task.timeLabel == null
                    ? context.getString(R.string.planner_timeline_widget_no_time)
                    : task.timeLabel
            );
            views.setTextViewText(TIMELINE_TITLE_IDS[index], task.title);
            views.setTextColor(TIMELINE_TIME_IDS[index], context.getColor(R.color.planner_widget_text_soft));
            views.setTextColor(TIMELINE_TITLE_IDS[index], context.getColor(R.color.planner_widget_text));
            views.setContentDescription(
                rowId,
                context.getString(R.string.planner_widget_complete_task_content_description, task.title)
            );
            views.setOnClickPendingIntent(rowId, createCompleteTaskPendingIntent(context, task));
            views.setOnClickPendingIntent(checkboxId, createCompleteTaskPendingIntent(context, task));
            views.setViewVisibility(rowId, View.VISIBLE);
        }

        if (visibleTaskCount == 0) {
            views.setTextViewText(R.id.planner_timeline_empty, emptyText);
            views.setViewVisibility(R.id.planner_timeline_empty, View.VISIBLE);
            return;
        }

        views.setViewVisibility(R.id.planner_timeline_empty, View.GONE);
    }

    private static List<PlannerWidgetTask> getTimelineTasks(List<PlannerWidgetTask> tasks) {
        List<PlannerWidgetTask> timelineTasks = new ArrayList<>();

        for (PlannerWidgetTask task : tasks) {
            if (!task.isOverdue && task.timeLabel != null && !task.timeLabel.isEmpty()) {
                timelineTasks.add(task);
            }
        }

        if (!timelineTasks.isEmpty()) {
            return timelineTasks;
        }

        return tasks;
    }

    private static void handleCompleteTask(Context context, Intent intent) {
        String taskId = intent.getStringExtra(PlannerWidgetStorage.EXTRA_WIDGET_TASK_ID);

        if (PlannerWidgetStorage.storePendingCompletedTaskId(context, taskId)) {
            PlannerWidgetStorage.markTaskCompletedInSnapshot(context, taskId);
        }

        PlannerWidgetUpdateDispatcher.updateAllWidgets(context);
    }

    private static PendingIntent createCompleteTaskPendingIntent(Context context, PlannerWidgetTask task) {
        Intent intent = new Intent(context, PlannerTimelineWidgetProvider.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

        intent.setAction(PlannerWidgetStorage.ACTION_COMPLETE_TASK);
        intent.putExtra(PlannerWidgetStorage.EXTRA_WIDGET_TASK_ID, task.id);

        return PendingIntent.getBroadcast(context, task.id.hashCode(), intent, flags);
    }

    private static int getTaskLimit(AppWidgetManager appWidgetManager, int appWidgetId) {
        Bundle options = appWidgetManager.getAppWidgetOptions(appWidgetId);
        int minHeight = options == null
            ? DEFAULT_WIDGET_HEIGHT_DP
            : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, DEFAULT_WIDGET_HEIGHT_DP);
        int maxHeight = options == null
            ? minHeight
            : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, minHeight);
        int effectiveHeight = Math.max(minHeight, maxHeight);

        return Math.max(1, Math.min(MAX_TIMELINE_TASKS, (effectiveHeight - 72) / 42));
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
