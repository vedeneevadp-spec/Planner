package ru.chaotika.app;

import android.app.AlarmManager;
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
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class PlannerWidgetProvider extends AppWidgetProvider {

    private static final int DEFAULT_WIDGET_HEIGHT_DP = 150;
    private static final int MAX_TASKS = PlannerWidgetContract.MAX_SNAPSHOT_TASKS;
    private static final int NEXT_DAY_REFRESH_REQUEST_CODE = 1008;
    private static final Locale RU_LOCALE = Locale.forLanguageTag("ru-RU");
    private static final int[] TASK_ROW_IDS = {
        R.id.planner_widget_task_row_1,
        R.id.planner_widget_task_row_2,
        R.id.planner_widget_task_row_3,
        R.id.planner_widget_task_row_4,
        R.id.planner_widget_task_row_5,
        R.id.planner_widget_task_row_6,
        R.id.planner_widget_task_row_7,
        R.id.planner_widget_task_row_8,
        R.id.planner_widget_task_row_9,
        R.id.planner_widget_task_row_10,
        R.id.planner_widget_task_row_11,
        R.id.planner_widget_task_row_12,
    };
    private static final int[] TASK_ICON_IDS = {
        R.id.planner_widget_task_icon_1,
        R.id.planner_widget_task_icon_2,
        R.id.planner_widget_task_icon_3,
        R.id.planner_widget_task_icon_4,
        R.id.planner_widget_task_icon_5,
        R.id.planner_widget_task_icon_6,
        R.id.planner_widget_task_icon_7,
        R.id.planner_widget_task_icon_8,
        R.id.planner_widget_task_icon_9,
        R.id.planner_widget_task_icon_10,
        R.id.planner_widget_task_icon_11,
        R.id.planner_widget_task_icon_12,
    };
    private static final int[] TASK_TITLE_IDS = {
        R.id.planner_widget_task_title_1,
        R.id.planner_widget_task_title_2,
        R.id.planner_widget_task_title_3,
        R.id.planner_widget_task_title_4,
        R.id.planner_widget_task_title_5,
        R.id.planner_widget_task_title_6,
        R.id.planner_widget_task_title_7,
        R.id.planner_widget_task_title_8,
        R.id.planner_widget_task_title_9,
        R.id.planner_widget_task_title_10,
        R.id.planner_widget_task_title_11,
        R.id.planner_widget_task_title_12,
    };
    private static final int[] TASK_CHECKBOX_IDS = {
        R.id.planner_widget_task_checkbox_1,
        R.id.planner_widget_task_checkbox_2,
        R.id.planner_widget_task_checkbox_3,
        R.id.planner_widget_task_checkbox_4,
        R.id.planner_widget_task_checkbox_5,
        R.id.planner_widget_task_checkbox_6,
        R.id.planner_widget_task_checkbox_7,
        R.id.planner_widget_task_checkbox_8,
        R.id.planner_widget_task_checkbox_9,
        R.id.planner_widget_task_checkbox_10,
        R.id.planner_widget_task_checkbox_11,
        R.id.planner_widget_task_checkbox_12,
    };

    @Override
    public void onEnabled(Context context) {
        scheduleNextDayRefresh(context);
    }

    @Override
    public void onDisabled(Context context) {
        cancelNextDayRefresh(context);
    }

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
            scheduleNextDayRefresh(context);
            return;
        }

        super.onReceive(context, intent);
        scheduleNextDayRefresh(context);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        scheduleNextDayRefresh(context);

        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    static void updateAllWidgets(Context context) {
        AppWidgetManager appWidgetManager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, PlannerWidgetProvider.class);
        int[] appWidgetIds = appWidgetManager.getAppWidgetIds(provider);

        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }

    private static void updateWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        RemoteViews views = buildRemoteViews(context, appWidgetManager, appWidgetId);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private static RemoteViews buildRemoteViews(
        Context context,
        AppWidgetManager appWidgetManager,
        int appWidgetId
    ) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.planner_today_widget);
        WidgetDisplayOptions displayOptions = getDisplayOptions(appWidgetManager, appWidgetId);
        String todayKey = getTodayKey();
        PlannerWidgetState state = PlannerWidgetContract.resolveState(
            PlannerWidgetStorage.readSnapshot(context),
            todayKey
        );
        PlannerWidgetSnapshot snapshot = state.snapshot;
        int backgroundOpacityPercent = PlannerWidgetStorage.readBackgroundOpacityPercent(context);

        views.setInt(
            R.id.planner_widget_root,
            "setBackgroundResource",
            getBackgroundResource(backgroundOpacityPercent)
        );
        views.setOnClickPendingIntent(
            R.id.planner_widget_add_button,
            createAddTaskPendingIntent(context)
        );
        applyDisplayOptions(views, displayOptions);
        views.setOnClickPendingIntent(R.id.planner_widget_root, createOpenTodayPendingIntent(context));
        views.setTextViewText(
            R.id.planner_widget_date,
            formatDateLabel(snapshot == null ? todayKey : snapshot.dateKey)
        );

        if (state.kind == PlannerWidgetStateKind.NO_SNAPSHOT) {
            bindUnavailableState(context, views, displayOptions);
            return views;
        }

        bindProgress(views, snapshot);

        if (state.kind == PlannerWidgetStateKind.STALE) {
            views.setTextViewText(
                R.id.planner_widget_title,
                context.getString(R.string.planner_widget_stale_title)
            );
            views.setTextViewText(
                R.id.planner_widget_summary,
                context.getString(R.string.planner_widget_stale_summary)
            );
            bindTaskRows(
                context,
                views,
                new ArrayList<>(),
                0,
                context.getString(R.string.planner_widget_stale_empty),
                displayOptions
            );
            return views;
        }

        views.setTextViewText(R.id.planner_widget_title, context.getString(R.string.planner_today_widget_title));
        views.setTextViewText(R.id.planner_widget_summary, buildSummaryText(context, snapshot));
        bindTaskRows(
            context,
            views,
            snapshot.tasks,
            snapshot.hiddenTaskCount,
            context.getString(R.string.planner_widget_empty_today),
            displayOptions
        );

        return views;
    }

    private static void bindUnavailableState(
        Context context,
        RemoteViews views,
        WidgetDisplayOptions displayOptions
    ) {
        views.setTextViewText(R.id.planner_widget_title, context.getString(R.string.planner_today_widget_title));
        views.setTextViewText(R.id.planner_widget_summary, context.getString(R.string.planner_widget_no_snapshot_summary));
        views.setProgressBar(R.id.planner_widget_progress, 100, 0, false);
        bindTaskRows(
            context,
            views,
            new ArrayList<>(),
            0,
            context.getString(R.string.planner_widget_no_snapshot_empty),
            displayOptions
        );
    }

    private static void bindProgress(RemoteViews views, PlannerWidgetSnapshot snapshot) {
        int totalToday = snapshot.todayCount + snapshot.doneTodayCount;
        int progress = totalToday == 0 ? 0 : Math.round((snapshot.doneTodayCount * 100f) / totalToday);

        views.setProgressBar(R.id.planner_widget_progress, 100, progress, false);
    }

    private static void bindTaskRows(
        Context context,
        RemoteViews views,
        List<PlannerWidgetTask> tasks,
        int hiddenTaskCount,
        String emptyText,
        WidgetDisplayOptions displayOptions
    ) {
        int defaultTextColor = context.getColor(R.color.planner_widget_text);
        int warningTextColor = context.getColor(R.color.planner_widget_warning);
        int visibleTaskCount = Math.min(tasks.size(), displayOptions.taskLimit);

        for (int taskRowId : TASK_ROW_IDS) {
            views.setViewVisibility(taskRowId, View.GONE);
        }

        for (int index = 0; index < visibleTaskCount; index += 1) {
            PlannerWidgetTask task = tasks.get(index);
            int taskRowId = TASK_ROW_IDS[index];
            int taskTitleId = TASK_TITLE_IDS[index];
            int taskCheckboxId = TASK_CHECKBOX_IDS[index];
            int taskAccentColor = PlannerWidgetVisuals.getTaskAccentColor(context, task);
            String taskText = buildTaskText(context, task);

            views.setImageViewBitmap(
                TASK_ICON_IDS[index],
                PlannerWidgetVisuals.createTaskIconBitmap(context, task)
            );
            views.setImageViewBitmap(
                taskCheckboxId,
                PlannerWidgetVisuals.createCheckboxBitmap(context, taskAccentColor)
            );
            views.setTextViewText(taskTitleId, taskText);
            views.setTextColor(taskTitleId, getTaskTextColor(context, task, defaultTextColor, warningTextColor));
            views.setFloat(taskTitleId, "setTextSize", displayOptions.taskTextSizeSp);
            views.setContentDescription(
                taskRowId,
                context.getString(R.string.planner_widget_complete_task_content_description, taskText)
            );
            views.setOnClickPendingIntent(taskRowId, createCompleteTaskPendingIntent(context, task));
            views.setOnClickPendingIntent(taskCheckboxId, createCompleteTaskPendingIntent(context, task));
            views.setViewVisibility(taskRowId, View.VISIBLE);
        }

        if (visibleTaskCount == 0) {
            views.setTextViewText(R.id.planner_widget_empty, emptyText);
            views.setViewVisibility(R.id.planner_widget_empty, View.VISIBLE);
            return;
        }

        int remainingCount = Math.max(0, hiddenTaskCount + tasks.size() - visibleTaskCount);

        if (remainingCount > 0) {
            views.setTextViewText(
                R.id.planner_widget_empty,
                context.getResources().getQuantityString(
                    R.plurals.planner_widget_more_tasks,
                    remainingCount,
                    remainingCount
                )
            );
            views.setViewVisibility(R.id.planner_widget_empty, View.VISIBLE);
            return;
        }

        views.setViewVisibility(R.id.planner_widget_empty, View.GONE);
    }

    private static String buildTaskText(Context context, PlannerWidgetTask task) {
        if (task.isOverdue) {
            return context.getString(R.string.planner_widget_overdue_task, task.title);
        }

        if (task.timeLabel != null && !task.timeLabel.isEmpty()) {
            return context.getString(R.string.planner_widget_timed_task, task.timeLabel, task.title);
        }

        return task.title;
    }

    private static int getTaskTextColor(
        Context context,
        PlannerWidgetTask task,
        int defaultTextColor,
        int warningTextColor
    ) {
        if ("in_progress".equals(task.visualTone)) {
            return context.getColor(R.color.planner_widget_in_progress);
        }

        if ("review".equals(task.visualTone)) {
            return context.getColor(R.color.planner_widget_review);
        }

        if ("urgent".equals(task.visualTone)) {
            return context.getColor(R.color.planner_widget_urgent);
        }

        if ("overdue".equals(task.visualTone) || task.isOverdue) {
            return warningTextColor;
        }

        return defaultTextColor;
    }

    private static String buildSummaryText(Context context, PlannerWidgetSnapshot snapshot) {
        int totalToday = snapshot.todayCount + snapshot.doneTodayCount;
        String summary = totalToday == 0
            ? context.getString(R.string.planner_widget_no_today_tasks)
            : context.getString(R.string.planner_widget_done_summary, snapshot.doneTodayCount, totalToday);

        if (snapshot.overdueCount > 0) {
            summary += " - " + context.getResources().getQuantityString(
                R.plurals.planner_widget_overdue_summary,
                snapshot.overdueCount,
                snapshot.overdueCount
            );
        }

        return summary;
    }

    private static void handleCompleteTask(Context context, Intent intent) {
        String taskId = intent.getStringExtra(PlannerWidgetStorage.EXTRA_WIDGET_TASK_ID);

        if (PlannerWidgetStorage.storePendingCompletedTaskId(context, taskId)) {
            PlannerWidgetStorage.markTaskCompletedInSnapshot(context, taskId);
        }

        PlannerWidgetUpdateDispatcher.updateAllWidgets(context);
    }

    private static PendingIntent createCompleteTaskPendingIntent(Context context, PlannerWidgetTask task) {
        Intent intent = new Intent(context, PlannerWidgetProvider.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

        intent.setAction(PlannerWidgetStorage.ACTION_COMPLETE_TASK);
        intent.putExtra(PlannerWidgetStorage.EXTRA_WIDGET_TASK_ID, task.id);

        return PendingIntent.getBroadcast(context, task.id.hashCode(), intent, flags);
    }

    static PendingIntent createOpenTodayPendingIntent(Context context) {
        return createOpenRoutePendingIntent(
            context,
            PlannerWidgetStorage.TODAY_ROUTE,
            1007,
            PlannerWidgetStorage.ACTION_OPEN_TODAY
        );
    }

    static PendingIntent createAddTaskPendingIntent(Context context) {
        return createOpenRoutePendingIntent(
            context,
            PlannerWidgetStorage.ADD_TASK_ROUTE,
            1010,
            PlannerWidgetStorage.ACTION_ADD_TASK
        );
    }

    private static PendingIntent createOpenRoutePendingIntent(
        Context context,
        String route,
        int requestCode,
        String action
    ) {
        Intent intent = new Intent(context, MainActivity.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

        intent.setAction(action);
        intent.putExtra(PlannerWidgetStorage.EXTRA_WIDGET_ROUTE, route);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        return PendingIntent.getActivity(context, requestCode, intent, flags);
    }

    private static PendingIntent createRefreshPendingIntent(Context context) {
        Intent intent = new Intent(context, PlannerWidgetProvider.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

        intent.setAction(PlannerWidgetStorage.ACTION_REFRESH_WIDGET);

        return PendingIntent.getBroadcast(context, NEXT_DAY_REFRESH_REQUEST_CODE, intent, flags);
    }

    private static void scheduleNextDayRefresh(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);

        if (alarmManager == null) {
            return;
        }

        alarmManager.set(
            AlarmManager.RTC_WAKEUP,
            getNextDayRefreshAtMillis(),
            createRefreshPendingIntent(context)
        );
    }

    private static void cancelNextDayRefresh(Context context) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);

        if (alarmManager == null) {
            return;
        }

        alarmManager.cancel(createRefreshPendingIntent(context));
    }

    private static long getNextDayRefreshAtMillis() {
        Calendar calendar = Calendar.getInstance();

        calendar.add(Calendar.DAY_OF_YEAR, 1);
        calendar.set(Calendar.HOUR_OF_DAY, 0);
        calendar.set(Calendar.MINUTE, 1);
        calendar.set(Calendar.SECOND, 0);
        calendar.set(Calendar.MILLISECOND, 0);

        return calendar.getTimeInMillis();
    }

    private static WidgetDisplayOptions getDisplayOptions(
        AppWidgetManager appWidgetManager,
        int appWidgetId
    ) {
        Bundle options = appWidgetManager.getAppWidgetOptions(appWidgetId);
        int minHeight = options == null
            ? DEFAULT_WIDGET_HEIGHT_DP
            : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, DEFAULT_WIDGET_HEIGHT_DP);
        int maxHeight = options == null
            ? minHeight
            : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, minHeight);
        int effectiveHeight = Math.max(minHeight, maxHeight);
        boolean showDate = effectiveHeight >= 130;
        boolean showProgress = effectiveHeight >= 125;
        int taskLimit = Math.max(1, Math.min(MAX_TASKS, (effectiveHeight - 105) / 32));
        float taskTextSizeSp = effectiveHeight >= 260 ? 18f : 17f;

        return new WidgetDisplayOptions(taskLimit, taskTextSizeSp, showDate, showProgress);
    }

    private static void applyDisplayOptions(RemoteViews views, WidgetDisplayOptions displayOptions) {
        views.setViewVisibility(R.id.planner_widget_date, displayOptions.showDate ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.planner_widget_progress, displayOptions.showProgress ? View.VISIBLE : View.GONE);
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

    private static final class WidgetDisplayOptions {
        final boolean showDate;
        final boolean showProgress;
        final int taskLimit;
        final float taskTextSizeSp;

        WidgetDisplayOptions(int taskLimit, float taskTextSizeSp, boolean showDate, boolean showProgress) {
            this.taskLimit = taskLimit;
            this.taskTextSizeSp = taskTextSizeSp;
            this.showDate = showDate;
            this.showProgress = showProgress;
        }
    }
}
