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
    private static final int[] TASK_VIEW_IDS = {
        R.id.planner_widget_task_1,
        R.id.planner_widget_task_2,
        R.id.planner_widget_task_3,
        R.id.planner_widget_task_4,
        R.id.planner_widget_task_5,
        R.id.planner_widget_task_6,
        R.id.planner_widget_task_7,
        R.id.planner_widget_task_8,
        R.id.planner_widget_task_9,
        R.id.planner_widget_task_10,
        R.id.planner_widget_task_11,
        R.id.planner_widget_task_12,
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
            updateAllWidgets(context);
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

        views.setInt(
            R.id.planner_widget_root,
            "setBackgroundResource",
            getBackgroundResource(PlannerWidgetStorage.readBackgroundOpacityPercent(context))
        );
        applyDisplayOptions(views, displayOptions);
        views.setOnClickPendingIntent(R.id.planner_widget_root, createOpenTodayPendingIntent(context));
        views.setTextViewText(R.id.planner_widget_date, formatDateLabel(snapshot == null ? todayKey : snapshot.dateKey));

        if (state.kind == PlannerWidgetStateKind.NO_SNAPSHOT) {
            bindUnavailableState(context, views, displayOptions);
            return views;
        }

        bindProgress(views, snapshot);

        if (state.kind == PlannerWidgetStateKind.STALE) {
            views.setTextViewText(R.id.planner_widget_title, context.getString(R.string.planner_widget_stale_title));
            views.setTextViewText(R.id.planner_widget_summary, context.getString(R.string.planner_widget_stale_summary));
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

        for (int taskViewId : TASK_VIEW_IDS) {
            views.setViewVisibility(taskViewId, View.GONE);
        }

        for (int index = 0; index < visibleTaskCount; index += 1) {
            PlannerWidgetTask task = tasks.get(index);
            int taskViewId = TASK_VIEW_IDS[index];
            String taskText = buildTaskText(context, task);

            views.setTextViewText(taskViewId, context.getString(R.string.planner_widget_task_action_prefix, taskText));
            views.setTextColor(taskViewId, getTaskTextColor(context, task, defaultTextColor, warningTextColor));
            views.setContentDescription(
                taskViewId,
                context.getString(R.string.planner_widget_complete_task_content_description, taskText)
            );
            views.setOnClickPendingIntent(taskViewId, createCompleteTaskPendingIntent(context, task));
            views.setViewVisibility(taskViewId, View.VISIBLE);
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

        updateAllWidgets(context);
    }

    private static PendingIntent createCompleteTaskPendingIntent(Context context, PlannerWidgetTask task) {
        Intent intent = new Intent(context, PlannerWidgetProvider.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

        intent.setAction(PlannerWidgetStorage.ACTION_COMPLETE_TASK);
        intent.putExtra(PlannerWidgetStorage.EXTRA_WIDGET_TASK_ID, task.id);

        return PendingIntent.getBroadcast(context, task.id.hashCode(), intent, flags);
    }

    private static PendingIntent createOpenTodayPendingIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

        intent.setAction(PlannerWidgetStorage.ACTION_OPEN_TODAY);
        intent.putExtra(PlannerWidgetStorage.EXTRA_WIDGET_ROUTE, PlannerWidgetStorage.TODAY_ROUTE);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        return PendingIntent.getActivity(context, 1007, intent, flags);
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
        boolean showDate = minHeight >= 130;
        boolean showProgress = minHeight >= 125;
        int taskLimit = Math.max(1, Math.min(MAX_TASKS, (minHeight - 70) / 24));

        return new WidgetDisplayOptions(taskLimit, showDate, showProgress);
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

        WidgetDisplayOptions(int taskLimit, boolean showDate, boolean showProgress) {
            this.taskLimit = taskLimit;
            this.showDate = showDate;
            this.showProgress = showProgress;
        }
    }
}
