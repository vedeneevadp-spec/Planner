package ru.chaotika.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public class PlannerWidgetProvider extends AppWidgetProvider {

    private static final int MAX_TASKS = 5;
    private static final Locale RU_LOCALE = Locale.forLanguageTag("ru-RU");
    private static final int[] TASK_VIEW_IDS = {
        R.id.planner_widget_task_1,
        R.id.planner_widget_task_2,
        R.id.planner_widget_task_3,
        R.id.planner_widget_task_4,
        R.id.planner_widget_task_5,
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
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
        RemoteViews views = buildRemoteViews(context);

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private static RemoteViews buildRemoteViews(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.planner_today_widget);
        WidgetSnapshot snapshot = readSnapshot(context);
        String todayKey = getTodayKey();

        views.setOnClickPendingIntent(R.id.planner_widget_root, createOpenTodayPendingIntent(context));
        views.setTextViewText(R.id.planner_widget_date, formatDateLabel(snapshot == null ? todayKey : snapshot.dateKey));

        if (snapshot == null) {
            bindUnavailableState(context, views);
            return views;
        }

        bindProgress(views, snapshot);

        if (!todayKey.equals(snapshot.dateKey)) {
            views.setTextViewText(R.id.planner_widget_title, context.getString(R.string.planner_widget_stale_title));
            views.setTextViewText(R.id.planner_widget_summary, context.getString(R.string.planner_widget_stale_summary));
            bindTaskRows(context, views, new ArrayList<>(), 0, context.getString(R.string.planner_widget_stale_empty));
            return views;
        }

        views.setTextViewText(R.id.planner_widget_title, context.getString(R.string.planner_today_widget_title));
        views.setTextViewText(R.id.planner_widget_summary, buildSummaryText(context, snapshot));
        bindTaskRows(context, views, snapshot.tasks, snapshot.moreCount, context.getString(R.string.planner_widget_empty_today));

        return views;
    }

    private static void bindUnavailableState(Context context, RemoteViews views) {
        views.setTextViewText(R.id.planner_widget_title, context.getString(R.string.planner_today_widget_title));
        views.setTextViewText(R.id.planner_widget_summary, context.getString(R.string.planner_widget_no_snapshot_summary));
        views.setProgressBar(R.id.planner_widget_progress, 100, 0, false);
        bindTaskRows(context, views, new ArrayList<>(), 0, context.getString(R.string.planner_widget_no_snapshot_empty));
    }

    private static void bindProgress(RemoteViews views, WidgetSnapshot snapshot) {
        int totalToday = snapshot.todayCount + snapshot.doneTodayCount;
        int progress = totalToday == 0 ? 0 : Math.round((snapshot.doneTodayCount * 100f) / totalToday);

        views.setProgressBar(R.id.planner_widget_progress, 100, progress, false);
    }

    private static void bindTaskRows(
        Context context,
        RemoteViews views,
        List<WidgetTask> tasks,
        int moreCount,
        String emptyText
    ) {
        int defaultTextColor = context.getColor(R.color.planner_widget_text);
        int warningTextColor = context.getColor(R.color.planner_widget_warning);

        for (int taskViewId : TASK_VIEW_IDS) {
            views.setViewVisibility(taskViewId, View.GONE);
        }

        for (int index = 0; index < Math.min(tasks.size(), TASK_VIEW_IDS.length); index += 1) {
            WidgetTask task = tasks.get(index);
            int taskViewId = TASK_VIEW_IDS[index];

            views.setTextViewText(taskViewId, buildTaskText(context, task));
            views.setTextColor(taskViewId, task.isOverdue ? warningTextColor : defaultTextColor);
            views.setViewVisibility(taskViewId, View.VISIBLE);
        }

        if (tasks.isEmpty()) {
            views.setTextViewText(R.id.planner_widget_empty, emptyText);
            views.setViewVisibility(R.id.planner_widget_empty, View.VISIBLE);
            return;
        }

        if (moreCount > 0) {
            views.setTextViewText(
                R.id.planner_widget_empty,
                context.getResources().getQuantityString(R.plurals.planner_widget_more_tasks, moreCount, moreCount)
            );
            views.setViewVisibility(R.id.planner_widget_empty, View.VISIBLE);
            return;
        }

        views.setViewVisibility(R.id.planner_widget_empty, View.GONE);
    }

    private static String buildTaskText(Context context, WidgetTask task) {
        if (task.isOverdue) {
            return context.getString(R.string.planner_widget_overdue_task, task.title);
        }

        if (task.timeLabel != null && !task.timeLabel.isEmpty()) {
            return context.getString(R.string.planner_widget_timed_task, task.timeLabel, task.title);
        }

        return task.title;
    }

    private static String buildSummaryText(Context context, WidgetSnapshot snapshot) {
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

    private static PendingIntent createOpenTodayPendingIntent(Context context) {
        Intent intent = new Intent(context, MainActivity.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

        intent.setAction(PlannerWidgetStorage.ACTION_OPEN_TODAY);
        intent.putExtra(PlannerWidgetStorage.EXTRA_WIDGET_ROUTE, PlannerWidgetStorage.TODAY_ROUTE);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);

        return PendingIntent.getActivity(context, 1007, intent, flags);
    }

    private static WidgetSnapshot readSnapshot(Context context) {
        String rawSnapshot = PlannerWidgetStorage.readSnapshot(context);

        if (rawSnapshot == null || rawSnapshot.isEmpty()) {
            return null;
        }

        try {
            JSONObject value = new JSONObject(rawSnapshot);
            String dateKey = value.optString("dateKey", "");

            if (value.optInt("version", 0) != 1 || dateKey.isEmpty()) {
                return null;
            }

            JSONArray taskValues = value.optJSONArray("tasks");
            List<WidgetTask> tasks = new ArrayList<>();

            if (taskValues != null) {
                for (int index = 0; index < Math.min(taskValues.length(), MAX_TASKS); index += 1) {
                    JSONObject taskValue = taskValues.optJSONObject(index);
                    WidgetTask task = parseTask(taskValue);

                    if (task != null) {
                        tasks.add(task);
                    }
                }
            }

            return new WidgetSnapshot(
                dateKey,
                Math.max(0, value.optInt("todayCount", 0)),
                Math.max(0, value.optInt("doneTodayCount", 0)),
                Math.max(0, value.optInt("overdueCount", 0)),
                Math.max(0, value.optInt("moreCount", 0)),
                tasks
            );
        } catch (JSONException exception) {
            return null;
        }
    }

    private static WidgetTask parseTask(JSONObject value) {
        if (value == null) {
            return null;
        }

        String title = value.optString("title", "").trim();

        if (title.isEmpty()) {
            return null;
        }

        String timeLabel = value.isNull("timeLabel") ? null : value.optString("timeLabel", null);

        return new WidgetTask(title, timeLabel, value.optBoolean("isOverdue", false));
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

    private static final class WidgetSnapshot {
        final String dateKey;
        final int doneTodayCount;
        final int moreCount;
        final int overdueCount;
        final List<WidgetTask> tasks;
        final int todayCount;

        WidgetSnapshot(
            String dateKey,
            int todayCount,
            int doneTodayCount,
            int overdueCount,
            int moreCount,
            List<WidgetTask> tasks
        ) {
            this.dateKey = dateKey;
            this.todayCount = todayCount;
            this.doneTodayCount = doneTodayCount;
            this.overdueCount = overdueCount;
            this.moreCount = moreCount;
            this.tasks = tasks;
        }
    }

    private static final class WidgetTask {
        final boolean isOverdue;
        final String timeLabel;
        final String title;

        WidgetTask(String title, String timeLabel, boolean isOverdue) {
            this.title = title;
            this.timeLabel = timeLabel;
            this.isOverdue = isOverdue;
        }
    }
}
