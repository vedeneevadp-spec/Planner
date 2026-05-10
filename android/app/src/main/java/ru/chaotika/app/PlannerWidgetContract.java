package ru.chaotika.app;

import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class PlannerWidgetContract {

    static final int MAX_SNAPSHOT_TASKS = 12;
    static final int SNAPSHOT_VERSION = 3;

    private PlannerWidgetContract() {}

    static PlannerWidgetSnapshot parseSnapshot(String rawSnapshot) {
        if (rawSnapshot == null || rawSnapshot.isEmpty()) {
            return null;
        }

        try {
            JSONObject value = new JSONObject(rawSnapshot);
            String dateKey = value.optString("dateKey", "");

            if (value.optInt("version", 0) != SNAPSHOT_VERSION || dateKey.isEmpty()) {
                return null;
            }

            JSONArray taskValues = value.optJSONArray("tasks");
            List<PlannerWidgetTask> tasks = new ArrayList<>();

            if (taskValues != null) {
                for (int index = 0; index < Math.min(taskValues.length(), MAX_SNAPSHOT_TASKS); index += 1) {
                    PlannerWidgetTask task = parseTask(taskValues.optJSONObject(index));

                    if (task != null) {
                        tasks.add(task);
                    }
                }
            }

            return new PlannerWidgetSnapshot(
                dateKey,
                nonNegativeInt(value.optInt("todayCount", 0)),
                nonNegativeInt(value.optInt("doneTodayCount", 0)),
                nonNegativeInt(value.optInt("overdueCount", 0)),
                nonNegativeInt(value.optInt("hiddenTaskCount", 0)),
                tasks
            );
        } catch (JSONException exception) {
            return null;
        }
    }

    static PlannerWidgetState resolveState(String rawSnapshot, String todayKey) {
        PlannerWidgetSnapshot snapshot = parseSnapshot(rawSnapshot);

        if (snapshot == null) {
            return new PlannerWidgetState(PlannerWidgetStateKind.NO_SNAPSHOT, null);
        }

        if (!todayKey.equals(snapshot.dateKey)) {
            return new PlannerWidgetState(PlannerWidgetStateKind.STALE, snapshot);
        }

        return new PlannerWidgetState(PlannerWidgetStateKind.VALID, snapshot);
    }

    static String markTaskDone(String rawSnapshot, String taskId, String generatedAt) {
        if (!isSupportedTaskId(taskId)) {
            return null;
        }

        PlannerWidgetSnapshot snapshot = parseSnapshot(rawSnapshot);

        if (snapshot == null) {
            return null;
        }

        try {
            JSONObject value = new JSONObject(rawSnapshot);
            JSONArray taskValues = value.optJSONArray("tasks");
            JSONArray nextTasks = new JSONArray();
            boolean didRemoveTask = false;
            boolean wasOverdue = false;

            if (taskValues != null) {
                for (int index = 0; index < taskValues.length(); index += 1) {
                    JSONObject taskValue = taskValues.optJSONObject(index);

                    if (taskValue == null) {
                        continue;
                    }

                    if (!didRemoveTask && taskId.equals(taskValue.optString("id", ""))) {
                        wasOverdue = taskValue.optBoolean("isOverdue", false);
                        didRemoveTask = true;
                        continue;
                    }

                    nextTasks.put(taskValue);
                }
            }

            if (!didRemoveTask) {
                return rawSnapshot;
            }

            value.put("tasks", nextTasks);
            value.put("doneTodayCount", snapshot.doneTodayCount + 1);
            value.put("generatedAt", generatedAt);

            if (wasOverdue) {
                value.put("overdueCount", Math.max(0, snapshot.overdueCount - 1));
            } else {
                value.put("todayCount", Math.max(0, snapshot.todayCount - 1));
            }

            return value.toString();
        } catch (JSONException exception) {
            return null;
        }
    }

    private static PlannerWidgetTask parseTask(JSONObject value) {
        if (value == null) {
            return null;
        }

        String id = value.optString("id", "").trim();
        String title = value.optString("title", "").trim();

        if (!isSupportedTaskId(id) || title.isEmpty()) {
            return null;
        }

        String timeLabel = value.isNull("timeLabel") ? null : value.optString("timeLabel", null);

        return new PlannerWidgetTask(
            id,
            title,
            timeLabel,
            value.optBoolean("isOverdue", false),
            parseVisualTone(value.optString("visualTone", "default"))
        );
    }

    private static String parseVisualTone(String value) {
        if (
            "in_progress".equals(value) ||
            "overdue".equals(value) ||
            "review".equals(value) ||
            "urgent".equals(value)
        ) {
            return value;
        }

        return "default";
    }

    private static boolean isSupportedTaskId(String taskId) {
        return taskId != null && !taskId.trim().isEmpty();
    }

    private static int nonNegativeInt(int value) {
        return Math.max(0, value);
    }
}

enum PlannerWidgetStateKind {
    NO_SNAPSHOT,
    STALE,
    VALID,
}

final class PlannerWidgetState {
    final PlannerWidgetSnapshot snapshot;
    final PlannerWidgetStateKind kind;

    PlannerWidgetState(PlannerWidgetStateKind kind, PlannerWidgetSnapshot snapshot) {
        this.kind = kind;
        this.snapshot = snapshot;
    }
}

final class PlannerWidgetSnapshot {
    final String dateKey;
    final int doneTodayCount;
    final int hiddenTaskCount;
    final int overdueCount;
    final List<PlannerWidgetTask> tasks;
    final int todayCount;

    PlannerWidgetSnapshot(
        String dateKey,
        int todayCount,
        int doneTodayCount,
        int overdueCount,
        int hiddenTaskCount,
        List<PlannerWidgetTask> tasks
    ) {
        this.dateKey = dateKey;
        this.todayCount = todayCount;
        this.doneTodayCount = doneTodayCount;
        this.overdueCount = overdueCount;
        this.hiddenTaskCount = hiddenTaskCount;
        this.tasks = tasks;
    }
}

final class PlannerWidgetTask {
    final String id;
    final boolean isOverdue;
    final String timeLabel;
    final String title;
    final String visualTone;

    PlannerWidgetTask(String id, String title, String timeLabel, boolean isOverdue, String visualTone) {
        this.id = id;
        this.title = title;
        this.timeLabel = timeLabel;
        this.isOverdue = isOverdue;
        this.visualTone = visualTone;
    }
}
