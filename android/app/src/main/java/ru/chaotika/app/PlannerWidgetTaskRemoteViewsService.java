package ru.chaotika.app;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

public class PlannerWidgetTaskRemoteViewsService extends RemoteViewsService {

    private static final float DEFAULT_TASK_TEXT_SIZE_SP = 17f;
    private static final String EXTRA_WIDGET_KIND = "ru.chaotika.app.extra.WIDGET_KIND";
    private static final String EXTRA_TASK_TEXT_SIZE_SP = "ru.chaotika.app.extra.WIDGET_TASK_TEXT_SIZE_SP";
    private static final String KIND_TIMELINE = "timeline";
    private static final String KIND_TODAY = "today";
    private static final int VIEW_TYPE_COUNT = 3;

    static Intent createTodayIntent(Context context, int appWidgetId, float taskTextSizeSp) {
        return createAdapterIntent(context, appWidgetId, KIND_TODAY, taskTextSizeSp);
    }

    static Intent createTimelineIntent(Context context, int appWidgetId) {
        return createAdapterIntent(context, appWidgetId, KIND_TIMELINE, DEFAULT_TASK_TEXT_SIZE_SP);
    }

    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new TaskRemoteViewsFactory(getApplicationContext(), intent);
    }

    private static Intent createAdapterIntent(
        Context context,
        int appWidgetId,
        String widgetKind,
        float taskTextSizeSp
    ) {
        Intent intent = new Intent(context, PlannerWidgetTaskRemoteViewsService.class);

        intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId);
        intent.putExtra(EXTRA_WIDGET_KIND, widgetKind);
        intent.putExtra(EXTRA_TASK_TEXT_SIZE_SP, taskTextSizeSp);
        intent.setData(Uri.parse(intent.toUri(Intent.URI_INTENT_SCHEME)));

        return intent;
    }

    private static final class TaskRemoteViewsFactory implements RemoteViewsFactory {
        private final Context context;
        private final String packageName;
        private final String widgetKind;
        private final float taskTextSizeSp;
        private final List<PlannerWidgetTask> tasks = new ArrayList<>();
        private int hiddenTaskCount = 0;

        TaskRemoteViewsFactory(Context context, Intent intent) {
            this.context = context;
            this.packageName = context.getPackageName();
            this.widgetKind = KIND_TIMELINE.equals(intent.getStringExtra(EXTRA_WIDGET_KIND))
                ? KIND_TIMELINE
                : KIND_TODAY;
            this.taskTextSizeSp = intent.getFloatExtra(EXTRA_TASK_TEXT_SIZE_SP, DEFAULT_TASK_TEXT_SIZE_SP);
        }

        @Override
        public void onCreate() {
            onDataSetChanged();
        }

        @Override
        public void onDataSetChanged() {
            PlannerWidgetState state = PlannerWidgetContract.resolveState(
                PlannerWidgetStorage.readSnapshot(context),
                getTodayKey()
            );

            tasks.clear();
            hiddenTaskCount = 0;

            if (state.kind != PlannerWidgetStateKind.VALID || state.snapshot == null) {
                return;
            }

            if (isTimeline()) {
                tasks.addAll(getTimelineTasks(state.snapshot.tasks));
                return;
            }

            tasks.addAll(state.snapshot.tasks);
            hiddenTaskCount = state.snapshot.hiddenTaskCount;
        }

        @Override
        public void onDestroy() {
            tasks.clear();
        }

        @Override
        public int getCount() {
            return tasks.size() + (shouldShowMoreRow() ? 1 : 0);
        }

        @Override
        public RemoteViews getViewAt(int position) {
            if (position < 0 || position >= getCount()) {
                return null;
            }

            if (position >= tasks.size()) {
                return buildMoreRow();
            }

            PlannerWidgetTask task = tasks.get(position);

            return isTimeline() ? buildTimelineTaskRow(task) : buildTodayTaskRow(task);
        }

        @Override
        public RemoteViews getLoadingView() {
            return null;
        }

        @Override
        public int getViewTypeCount() {
            return VIEW_TYPE_COUNT;
        }

        @Override
        public long getItemId(int position) {
            if (position < tasks.size()) {
                return tasks.get(position).id.hashCode();
            }

            return Long.MAX_VALUE;
        }

        @Override
        public boolean hasStableIds() {
            return true;
        }

        private RemoteViews buildTodayTaskRow(PlannerWidgetTask task) {
            RemoteViews views = new RemoteViews(packageName, R.layout.planner_widget_task_list_item);
            int accentColor = PlannerWidgetVisuals.getTaskAccentColor(context, task);
            String taskText = buildTaskText(context, task);

            views.setImageViewBitmap(
                R.id.planner_widget_task_item_icon,
                PlannerWidgetVisuals.createTaskIconBitmap(context, task)
            );
            views.setImageViewBitmap(
                R.id.planner_widget_task_item_checkbox,
                PlannerWidgetVisuals.createCheckboxBitmap(context, accentColor)
            );
            views.setTextViewText(R.id.planner_widget_task_item_title, taskText);
            views.setTextColor(
                R.id.planner_widget_task_item_title,
                PlannerWidgetVisuals.getTaskTextColor(context, task)
            );
            views.setFloat(R.id.planner_widget_task_item_title, "setTextSize", taskTextSizeSp);
            views.setContentDescription(
                R.id.planner_widget_task_item_row,
                context.getString(R.string.planner_widget_complete_task_content_description, taskText)
            );
            bindCompleteIntent(views, R.id.planner_widget_task_item_row, task);
            bindCompleteIntent(views, R.id.planner_widget_task_item_checkbox, task);

            return views;
        }

        private RemoteViews buildTimelineTaskRow(PlannerWidgetTask task) {
            RemoteViews views = new RemoteViews(packageName, R.layout.planner_timeline_task_list_item);
            int accentColor = PlannerWidgetVisuals.getTaskAccentColor(context, task);

            views.setImageViewBitmap(
                R.id.planner_timeline_task_item_icon,
                PlannerWidgetVisuals.createTaskIconBitmap(context, task)
            );
            views.setImageViewBitmap(
                R.id.planner_timeline_task_item_checkbox,
                PlannerWidgetVisuals.createCheckboxBitmap(context, accentColor)
            );
            views.setTextViewText(
                R.id.planner_timeline_task_item_time,
                task.timeLabel == null
                    ? context.getString(R.string.planner_timeline_widget_no_time)
                    : task.timeLabel
            );
            views.setTextViewText(R.id.planner_timeline_task_item_title, task.title);
            views.setTextColor(
                R.id.planner_timeline_task_item_time,
                context.getColor(R.color.planner_widget_text_soft)
            );
            views.setTextColor(
                R.id.planner_timeline_task_item_title,
                PlannerWidgetVisuals.getTaskTextColor(context, task)
            );
            views.setContentDescription(
                R.id.planner_timeline_task_item_row,
                context.getString(R.string.planner_widget_complete_task_content_description, task.title)
            );
            bindCompleteIntent(views, R.id.planner_timeline_task_item_row, task);
            bindCompleteIntent(views, R.id.planner_timeline_task_item_checkbox, task);

            return views;
        }

        private RemoteViews buildMoreRow() {
            RemoteViews views = new RemoteViews(packageName, R.layout.planner_widget_more_list_item);

            views.setTextViewText(
                R.id.planner_widget_more_text,
                context.getResources().getQuantityString(
                    R.plurals.planner_widget_more_tasks,
                    hiddenTaskCount,
                    hiddenTaskCount
                )
            );

            return views;
        }

        private void bindCompleteIntent(RemoteViews views, int viewId, PlannerWidgetTask task) {
            Intent fillInIntent = new Intent();

            fillInIntent.putExtra(PlannerWidgetStorage.EXTRA_WIDGET_TASK_ID, task.id);
            views.setOnClickFillInIntent(viewId, fillInIntent);
        }

        private boolean isTimeline() {
            return KIND_TIMELINE.equals(widgetKind);
        }

        private boolean shouldShowMoreRow() {
            return !isTimeline() && hiddenTaskCount > 0;
        }
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

    private static String getTodayKey() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }
}
