package ru.chaotika.app;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** Builds the native widget snapshot from the existing Planner API responses. */
final class PlannerWidgetSnapshotFactory {

    private static final int MAX_TASKS_PER_SOURCE = 24;
    private static final Locale RU_LOCALE = Locale.forLanguageTag("ru-RU");
    private static final Pattern COLOR_PATTERN = Pattern.compile("^#[0-9a-fA-F]{6}$");
    private static final Pattern ISO_INSTANT_PATTERN = Pattern.compile(
        "^(\\d{4})-(\\d{2})-(\\d{2})T(\\d{2}):(\\d{2}):(\\d{2})" +
        "(?:\\.(\\d{1,9}))?(Z|[+-]\\d{2}:?\\d{2})$"
    );
    private static final Pattern TIME_PATTERN = Pattern.compile("(?:T)?(\\d{2}:\\d{2})");

    private PlannerWidgetSnapshotFactory() {}

    static String buildSnapshot(
        JSONArray taskValues,
        JSONArray sphereValues,
        JSONObject selfCareDashboard,
        JSONObject cleaningToday,
        String timeZoneId,
        Date now
    ) throws JSONException {
        TimeZone timeZone = resolveTimeZone(timeZoneId);
        String dateKey = formatDateKey(now, timeZone);
        String tomorrowKey = addDateDays(dateKey, 1, timeZone);
        SphereLookup sphereLookup = createSphereLookup(sphereValues);
        List<WidgetTaskCandidate> plannerTasks = new ArrayList<>();
        int todayCount = 0;
        int doneTodayCount = 0;
        int overdueCount = 0;

        for (int index = 0; index < taskValues.length(); index += 1) {
            JSONObject task = taskValues.optJSONObject(index);

            if (task == null) {
                continue;
            }

            String status = task.optString("status", "todo");
            DisplayedSchedule schedule = getDisplayedSchedule(task, timeZone);

            if ("done".equals(status)) {
                Long completedAt = parseInstantMillis(nullableString(task, "completedAt"));

                if (
                    completedAt != null &&
                    dateKey.equals(formatDateKey(new Date(completedAt), timeZone))
                ) {
                    doneTodayCount += 1;
                }

                continue;
            }

            if ("archived".equals(status)) {
                continue;
            }

            boolean isOverdue = schedule.plannedDate != null && schedule.plannedDate.compareTo(dateKey) < 0;

            if (dateKey.equals(schedule.plannedDate)) {
                todayCount += 1;
            }

            if (isOverdue) {
                overdueCount += 1;
            }

            WidgetTaskCandidate candidate = createPlannerTask(
                task,
                schedule,
                isOverdue,
                dateKey,
                tomorrowKey,
                sphereLookup
            );

            if (candidate != null) {
                plannerTasks.add(candidate);
            }
        }

        Collections.sort(plannerTasks, PlannerWidgetSnapshotFactory::comparePlannerTasks);

        List<WidgetTaskCandidate> selfCareTasks = buildSelfCareTasks(
            selfCareDashboard,
            dateKey,
            timeZone
        );
        List<WidgetTaskCandidate> cleaningTasks = buildCleaningTasks(cleaningToday);
        List<WidgetTaskCandidate> visibleTasks = new ArrayList<>();

        addLimited(visibleTasks, plannerTasks);
        addLimited(visibleTasks, selfCareTasks);
        addLimited(visibleTasks, cleaningTasks);
        Collections.sort(visibleTasks, PlannerWidgetSnapshotFactory::compareCombinedTasks);

        JSONArray snapshotTasks = new JSONArray();

        for (WidgetTaskCandidate task : visibleTasks) {
            snapshotTasks.put(task.value);
        }

        JSONObject snapshot = new JSONObject();

        snapshot.put("version", PlannerWidgetContract.SNAPSHOT_VERSION);
        snapshot.put("dateKey", dateKey);
        snapshot.put("generatedAt", formatUtc(now));
        snapshot.put("todayCount", todayCount);
        snapshot.put("doneTodayCount", doneTodayCount);
        snapshot.put("overdueCount", overdueCount);
        snapshot.put("hiddenTaskCount", Math.max(0, plannerTasks.size() - MAX_TASKS_PER_SOURCE));
        snapshot.put(
            "hiddenSelfCareTaskCount",
            Math.max(0, selfCareTasks.size() - MAX_TASKS_PER_SOURCE)
        );
        snapshot.put(
            "hiddenCleaningTaskCount",
            Math.max(0, cleaningTasks.size() - MAX_TASKS_PER_SOURCE)
        );
        snapshot.put("tasks", snapshotTasks);

        return snapshot.toString();
    }

    private static WidgetTaskCandidate createPlannerTask(
        JSONObject task,
        DisplayedSchedule schedule,
        boolean isOverdue,
        String dateKey,
        String tomorrowKey,
        SphereLookup sphereLookup
    ) throws JSONException {
        String id = task.optString("id", "").trim();

        if (id.isEmpty()) {
            return null;
        }

        JSONObject sphere = findSphere(task, sphereLookup);
        String title = normalizeTitle(task.optString("title", ""));
        String dateBucket = getDateBucket(schedule.plannedDate, isOverdue, dateKey, tomorrowKey);
        String status = task.optString("status", "todo");
        String urgency = task.optString("urgency", "not_urgent");
        JSONObject value = new JSONObject();

        value.put("canComplete", true);
        value.put("color", normalizeColor(sphere == null ? null : nullableString(sphere, "color")));
        value.put("dateBucket", dateBucket);
        value.put(
            "icon",
            firstNonEmpty(task.optString("icon", ""), sphere == null ? "" : sphere.optString("icon", ""))
        );
        value.put("id", id);
        value.put("isOverdue", isOverdue);
        value.put("source", "planner");
        value.put(
            "timeLabel",
            dateKey.equals(schedule.plannedDate) && schedule.plannedStartTime != null
                ? formatTimeRange(schedule.plannedStartTime, schedule.plannedEndTime)
                : JSONObject.NULL
        );
        value.put("title", getPlannerTitle(title, schedule.plannedDate, isOverdue, dateKey, tomorrowKey));
        value.put("visualTone", getPlannerVisualTone(status, urgency, isOverdue));

        return new WidgetTaskCandidate(
            value,
            dateBucket,
            nullableString(value, "timeLabel"),
            statusWeight(status),
            schedule.plannedDate,
            schedule.plannedStartTime,
            priorityWeight(task.optString("importance", "not_important"), urgency),
            task.optString("createdAt", "")
        );
    }

    private static List<WidgetTaskCandidate> buildSelfCareTasks(
        JSONObject dashboard,
        String dateKey,
        TimeZone defaultTimeZone
    ) throws JSONException {
        List<WidgetTaskCandidate> result = new ArrayList<>();

        if (dashboard == null) {
            return result;
        }

        JSONArray overdueItems = dashboard.optJSONArray("overdueItems");
        Set<String> overdueKeys = new HashSet<>();

        addSelfCareKeys(overdueKeys, overdueItems);

        Map<String, JSONObject> entries = new LinkedHashMap<>();

        addSelfCareEntries(entries, overdueItems, false);
        addSelfCareEntries(entries, dashboard.optJSONArray("todayItems"), false);
        addSelfCareEntries(entries, dashboard.optJSONArray("flexibleGoals"), true);

        for (Map.Entry<String, JSONObject> keyedEntry : entries.entrySet()) {
            JSONObject entry = keyedEntry.getValue();

            if (!isVisibleSelfCareEntry(entry)) {
                continue;
            }

            JSONObject item = entry.optJSONObject("item");

            if (item == null) {
                continue;
            }

            JSONObject occurrence = entry.optJSONObject("occurrence");
            String scheduledFor = occurrence == null
                ? null
                : nullableString(occurrence, "scheduledFor");
            boolean isOverdue = overdueKeys.contains(keyedEntry.getKey()) ||
                (scheduledFor != null && scheduledFor.compareTo(dateKey) < 0);
            String timeLabel = getSelfCareTime(entry, defaultTimeZone);
            String dateBucket = isOverdue ? "overdue" : "today";
            JSONObject value = new JSONObject();

            value.put("canComplete", false);
            value.put("color", normalizeColor(nullableString(item, "color"), "#B9B3FF"));
            value.put("dateBucket", dateBucket);
            value.put("icon", firstNonEmpty(item.optString("icon", ""), "♥"));
            value.put("id", "self-care:" + keyedEntry.getKey());
            value.put("isOverdue", isOverdue);
            value.put("source", "self_care");
            value.put("timeLabel", timeLabel == null ? JSONObject.NULL : timeLabel);
            value.put("title", "Забота: " + normalizeTitle(item.optString("title", "")));
            value.put("visualTone", isOverdue ? "overdue" : "default");

            result.add(WidgetTaskCandidate.supplemental(value, dateBucket, timeLabel));
        }

        return result;
    }

    private static List<WidgetTaskCandidate> buildCleaningTasks(JSONObject today) throws JSONException {
        List<WidgetTaskCandidate> result = new ArrayList<>();

        if (today == null) {
            return result;
        }

        Map<String, JSONObject> entries = new LinkedHashMap<>();

        addCleaningEntries(entries, today.optJSONArray("items"));
        addCleaningEntries(entries, today.optJSONArray("generalItems"));

        for (Map.Entry<String, JSONObject> keyedEntry : entries.entrySet()) {
            JSONObject entry = keyedEntry.getValue();
            JSONObject task = entry.optJSONObject("task");

            if (task == null) {
                continue;
            }

            boolean isOverdue = entry.optBoolean("isOverdue", false);
            String priority = task.optString("priority", "normal");
            String dateBucket = isOverdue ? "overdue" : "today";
            JSONObject value = new JSONObject();

            value.put("canComplete", true);
            value.put(
                "color",
                "high".equals(priority) ? "#FFD166" : (isOverdue ? "#FF9F7A" : "#8EE7C8")
            );
            value.put("dateBucket", dateBucket);
            value.put("icon", "🧹");
            value.put("id", "cleaning:" + keyedEntry.getKey());
            value.put("isOverdue", isOverdue);
            value.put("source", "cleaning");
            value.put("timeLabel", JSONObject.NULL);
            value.put("title", "Уборка: " + normalizeTitle(task.optString("title", "")));
            value.put(
                "visualTone",
                "high".equals(priority) ? "urgent" : (isOverdue ? "overdue" : "default")
            );

            result.add(WidgetTaskCandidate.supplemental(value, dateBucket, null));
        }

        return result;
    }

    private static void addSelfCareKeys(Set<String> keys, JSONArray values) {
        if (values == null) {
            return;
        }

        for (int index = 0; index < values.length(); index += 1) {
            String key = getSelfCareEntryKey(values.optJSONObject(index));

            if (key != null) {
                keys.add(key);
            }
        }
    }

    private static void addSelfCareEntries(
        Map<String, JSONObject> entries,
        JSONArray values,
        boolean dailyFlexibleOnly
    ) {
        if (values == null) {
            return;
        }

        for (int index = 0; index < values.length(); index += 1) {
            JSONObject entry = values.optJSONObject(index);
            String key = getSelfCareEntryKey(entry);

            if (
                key == null ||
                entries.containsKey(key) ||
                (dailyFlexibleOnly && !isDailyFlexibleGoal(entry))
            ) {
                continue;
            }

            entries.put(key, entry);
        }
    }

    private static void addCleaningEntries(Map<String, JSONObject> entries, JSONArray values) {
        if (values == null) {
            return;
        }

        for (int index = 0; index < values.length(); index += 1) {
            JSONObject entry = values.optJSONObject(index);
            JSONObject task = entry == null ? null : entry.optJSONObject("task");
            String taskId = task == null ? "" : task.optString("id", "").trim();

            if (!taskId.isEmpty() && !entries.containsKey(taskId)) {
                entries.put(taskId, entry);
            }
        }
    }

    private static String getSelfCareEntryKey(JSONObject entry) {
        if (entry == null) {
            return null;
        }

        JSONObject occurrence = entry.optJSONObject("occurrence");
        String occurrenceId = occurrence == null ? "" : occurrence.optString("id", "").trim();

        if (!occurrenceId.isEmpty()) {
            return occurrenceId;
        }

        JSONObject item = entry.optJSONObject("item");
        String itemId = item == null ? "" : item.optString("id", "").trim();

        return itemId.isEmpty() ? null : itemId;
    }

    private static boolean isDailyFlexibleGoal(JSONObject entry) {
        if (entry == null) {
            return false;
        }

        JSONObject item = entry.optJSONObject("item");
        JSONObject rule = entry.optJSONObject("scheduleRule");

        return item != null &&
            rule != null &&
            "day".equals(rule.optString("flexiblePeriod", "")) &&
            (
                "flexible_goal".equals(item.optString("type", "")) ||
                "flexible_goal".equals(rule.optString("repeatKind", ""))
            );
    }

    private static boolean isVisibleSelfCareEntry(JSONObject entry) {
        if (entry == null) {
            return false;
        }

        JSONObject item = entry.optJSONObject("item");

        if (
            item == null ||
            item.optBoolean("isArchived", false) ||
            !item.optBoolean("isActive", false) ||
            !entry.isNull("completion")
        ) {
            return false;
        }

        JSONObject occurrence = entry.optJSONObject("occurrence");
        String occurrenceStatus = occurrence == null
            ? "scheduled"
            : occurrence.optString("status", "scheduled");

        if (
            "cancelled".equals(occurrenceStatus) ||
            "done".equals(occurrenceStatus) ||
            "missed".equals(occurrenceStatus) ||
            "moved".equals(occurrenceStatus) ||
            "partial".equals(occurrenceStatus) ||
            "skipped".equals(occurrenceStatus)
        ) {
            return false;
        }

        JSONObject course = entry.optJSONObject("courseDetails");
        JSONObject rule = entry.optJSONObject("scheduleRule");

        if ("course".equals(item.optString("type", "")) && course != null) {
            if (course.optBoolean("isCompleted", false) || course.optBoolean("isPaused", false)) {
                return false;
            }

            String startDate = rule == null ? null : nullableString(rule, "startDate");
            String scheduledFor = occurrence == null ? null : nullableString(occurrence, "scheduledFor");

            if (
                occurrence != null &&
                rule != null &&
                "course".equals(rule.optString("repeatKind", "")) &&
                startDate != null &&
                scheduledFor != null &&
                scheduledFor.compareTo(startDate) < 0
            ) {
                return false;
            }
        }

        JSONObject progress = entry.optJSONObject("flexibleProgress");

        return progress == null ||
            progress.optInt("completedCount", 0) < progress.optInt("targetCount", 0);
    }

    private static String getSelfCareTime(JSONObject entry, TimeZone defaultTimeZone) {
        JSONObject occurrence = entry.optJSONObject("occurrence");
        JSONObject appointment = entry.optJSONObject("appointment");
        JSONObject rule = entry.optJSONObject("scheduleRule");
        String sourceTime = firstNonEmptyOrNull(
            occurrence == null ? null : nullableString(occurrence, "dueAt"),
            appointment == null ? null : nullableString(appointment, "startsAt"),
            rule == null ? null : nullableString(rule, "preferredTime")
        );

        if (sourceTime == null) {
            return null;
        }

        if (sourceTime.contains("T")) {
            Long instantMillis = parseInstantMillis(sourceTime);

            if (instantMillis != null) {
                String sourceTimeZone = firstNonEmptyOrNull(
                    occurrence == null ? null : nullableString(occurrence, "reminderTimeZone"),
                    rule == null ? null : nullableString(rule, "timezone")
                );

                return formatTime(
                    new Date(instantMillis),
                    sourceTimeZone == null ? defaultTimeZone : resolveTimeZone(sourceTimeZone)
                );
            }
        }

        Matcher matcher = TIME_PATTERN.matcher(sourceTime);

        return matcher.find() ? matcher.group(1) : null;
    }

    private static DisplayedSchedule getDisplayedSchedule(JSONObject task, TimeZone displayTimeZone) {
        String legacyDate = nullableString(task, "plannedDate");
        String legacyStart = nullableString(task, "plannedStartTime");
        String legacyEnd = nullableString(task, "plannedEndTime");
        JSONObject schedule = task.optJSONObject("schedule");

        if (schedule == null || !"fixed_zone_datetime".equals(schedule.optString("kind", ""))) {
            return new DisplayedSchedule(legacyDate, legacyStart, legacyEnd);
        }

        Long instantMillis = parseInstantMillis(nullableString(schedule, "instantUtc"));

        if (instantMillis == null) {
            return new DisplayedSchedule(legacyDate, legacyStart, legacyEnd);
        }

        Integer durationMinutes = getDurationMinutes(
            firstNonEmptyOrNull(legacyStart, nullableString(schedule, "localTime")),
            legacyEnd
        );

        return new DisplayedSchedule(
            formatDateKey(new Date(instantMillis), displayTimeZone),
            formatTime(new Date(instantMillis), displayTimeZone),
            durationMinutes == null
                ? null
                : formatTime(new Date(instantMillis + durationMinutes * 60_000L), displayTimeZone)
        );
    }

    private static Integer getDurationMinutes(String start, String end) {
        Integer startMinutes = parseTimeMinutes(start);
        Integer endMinutes = parseTimeMinutes(end);

        if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
            return null;
        }

        return endMinutes - startMinutes;
    }

    private static Integer parseTimeMinutes(String value) {
        if (value == null || !value.matches("^\\d{2}:\\d{2}$")) {
            return null;
        }

        try {
            int hours = Integer.parseInt(value.substring(0, 2));
            int minutes = Integer.parseInt(value.substring(3, 5));

            return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
        } catch (NumberFormatException exception) {
            return null;
        }
    }

    static Long parseInstantMillis(String value) {
        if (value == null) {
            return null;
        }

        Matcher matcher = ISO_INSTANT_PATTERN.matcher(value.trim());

        if (!matcher.matches()) {
            return null;
        }

        try {
            String offset = matcher.group(8);
            TimeZone timeZone = "Z".equals(offset)
                ? TimeZone.getTimeZone("UTC")
                : TimeZone.getTimeZone("GMT" + normalizeOffset(offset));
            Calendar calendar = Calendar.getInstance(timeZone, Locale.US);

            calendar.clear();
            calendar.setLenient(false);
            calendar.set(Calendar.YEAR, Integer.parseInt(matcher.group(1)));
            calendar.set(Calendar.MONTH, Integer.parseInt(matcher.group(2)) - 1);
            calendar.set(Calendar.DAY_OF_MONTH, Integer.parseInt(matcher.group(3)));
            calendar.set(Calendar.HOUR_OF_DAY, Integer.parseInt(matcher.group(4)));
            calendar.set(Calendar.MINUTE, Integer.parseInt(matcher.group(5)));
            calendar.set(Calendar.SECOND, Integer.parseInt(matcher.group(6)));
            calendar.set(Calendar.MILLISECOND, parseMilliseconds(matcher.group(7)));

            return calendar.getTimeInMillis();
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    private static int parseMilliseconds(String fraction) {
        if (fraction == null || fraction.isEmpty()) {
            return 0;
        }

        String milliseconds = (fraction + "000").substring(0, 3);

        return Integer.parseInt(milliseconds);
    }

    private static String normalizeOffset(String offset) {
        return offset != null && offset.length() == 5
            ? offset.substring(0, 3) + ":" + offset.substring(3)
            : offset;
    }

    private static SphereLookup createSphereLookup(JSONArray sphereValues) {
        Map<String, JSONObject> byId = new HashMap<>();
        Map<String, JSONObject> byName = new HashMap<>();

        for (int index = 0; index < sphereValues.length(); index += 1) {
            JSONObject sphere = sphereValues.optJSONObject(index);

            if (sphere == null) {
                continue;
            }

            String id = sphere.optString("id", "").trim();
            String name = normalizeSphereName(sphere.optString("name", ""));

            if (!id.isEmpty()) {
                byId.put(id, sphere);
            }

            if (!name.isEmpty()) {
                byName.put(name, sphere);
            }
        }

        return new SphereLookup(byId, byName);
    }

    private static JSONObject findSphere(JSONObject task, SphereLookup lookup) {
        String sphereId = firstNonEmptyOrNull(
            nullableString(task, "sphereId"),
            nullableString(task, "projectId")
        );

        if (sphereId != null && lookup.byId.containsKey(sphereId)) {
            return lookup.byId.get(sphereId);
        }

        return lookup.byName.get(normalizeSphereName(task.optString("project", "")));
    }

    private static int comparePlannerTasks(WidgetTaskCandidate left, WidgetTaskCandidate right) {
        int bucketComparison = Integer.compare(bucketWeight(left.dateBucket), bucketWeight(right.dateBucket));

        if (bucketComparison != 0) {
            return bucketComparison;
        }

        int statusComparison = Integer.compare(left.statusWeight, right.statusWeight);

        if (statusComparison != 0) {
            return statusComparison;
        }

        int dateComparison = compareNullable(left.plannedDate, right.plannedDate, true);

        if (dateComparison != 0) {
            return dateComparison;
        }

        int timeComparison = compareNullable(left.plannedStartTime, right.plannedStartTime, true);

        if (timeComparison != 0) {
            return timeComparison;
        }

        int priorityComparison = Integer.compare(left.priorityWeight, right.priorityWeight);

        if (priorityComparison != 0) {
            return priorityComparison;
        }

        return left.createdAt.compareTo(right.createdAt);
    }

    private static int compareCombinedTasks(WidgetTaskCandidate left, WidgetTaskCandidate right) {
        int bucketComparison = Integer.compare(bucketWeight(left.dateBucket), bucketWeight(right.dateBucket));

        if (bucketComparison != 0) {
            return bucketComparison;
        }

        return compareNullable(left.timeLabel, right.timeLabel, true);
    }

    private static int compareNullable(String left, String right, boolean nullLast) {
        if (left == null && right == null) {
            return 0;
        }

        if (left == null) {
            return nullLast ? 1 : -1;
        }

        if (right == null) {
            return nullLast ? -1 : 1;
        }

        return left.compareTo(right);
    }

    private static int bucketWeight(String bucket) {
        if ("overdue".equals(bucket)) {
            return 0;
        }

        if ("today".equals(bucket)) {
            return 1;
        }

        if ("tomorrow".equals(bucket)) {
            return 2;
        }

        if ("future".equals(bucket)) {
            return 3;
        }

        return 4;
    }

    private static int statusWeight(String status) {
        if ("in_progress".equals(status)) {
            return 0;
        }

        if ("ready_for_review".equals(status)) {
            return 1;
        }

        return 2;
    }

    private static int priorityWeight(String importance, String urgency) {
        if ("important".equals(importance) && "urgent".equals(urgency)) {
            return 0;
        }

        if ("urgent".equals(urgency)) {
            return 1;
        }

        if ("important".equals(importance)) {
            return 2;
        }

        return 3;
    }

    private static String getDateBucket(
        String plannedDate,
        boolean isOverdue,
        String todayKey,
        String tomorrowKey
    ) {
        if (isOverdue) {
            return "overdue";
        }

        if (todayKey.equals(plannedDate)) {
            return "today";
        }

        if (tomorrowKey.equals(plannedDate)) {
            return "tomorrow";
        }

        return plannedDate == null ? "unscheduled" : "future";
    }

    private static String getPlannerTitle(
        String title,
        String plannedDate,
        boolean isOverdue,
        String todayKey,
        String tomorrowKey
    ) {
        if (isOverdue || todayKey.equals(plannedDate)) {
            return title;
        }

        if (tomorrowKey.equals(plannedDate)) {
            return "Завтра: " + title;
        }

        if (plannedDate != null) {
            return formatShortDate(plannedDate) + ": " + title;
        }

        return "Без даты: " + title;
    }

    private static String getPlannerVisualTone(String status, String urgency, boolean isOverdue) {
        if ("in_progress".equals(status)) {
            return "in_progress";
        }

        if ("ready_for_review".equals(status)) {
            return "review";
        }

        if ("urgent".equals(urgency)) {
            return "urgent";
        }

        return isOverdue ? "overdue" : "default";
    }

    private static String normalizeTitle(String value) {
        String title = value == null ? "" : value.trim();

        return title.isEmpty() ? "Без названия" : title;
    }

    private static String normalizeColor(String value) {
        return normalizeColor(value, PlannerWidgetContract.DEFAULT_TASK_COLOR);
    }

    private static String normalizeColor(String value, String fallback) {
        String color = value == null ? "" : value.trim();

        return COLOR_PATTERN.matcher(color).matches() ? color.toUpperCase(Locale.US) : fallback;
    }

    private static String firstNonEmpty(String first, String fallback) {
        String normalized = first == null ? "" : first.trim();

        return normalized.isEmpty() ? fallback.trim() : normalized;
    }

    private static String firstNonEmptyOrNull(String... values) {
        for (String value : values) {
            if (value != null && !value.trim().isEmpty()) {
                return value.trim();
            }
        }

        return null;
    }

    private static String nullableString(JSONObject value, String key) {
        if (value == null || value.isNull(key)) {
            return null;
        }

        String result = value.optString(key, "").trim();

        return result.isEmpty() ? null : result;
    }

    private static String normalizeSphereName(String value) {
        return value == null ? "" : value.trim().toLowerCase(RU_LOCALE);
    }

    private static String formatTimeRange(String start, String end) {
        String normalizedStart = normalizePlainTime(start);

        return end == null ? normalizedStart : normalizedStart + " - " + normalizePlainTime(end);
    }

    private static String normalizePlainTime(String value) {
        String[] parts = value.split(":", -1);
        String hours = parts.length > 0 ? parts[0] : "00";
        String minutes = parts.length > 1 ? parts[1] : "00";

        return String.format(Locale.US, "%02d:%02d", parseInt(hours), parseInt(minutes));
    }

    private static int parseInt(String value) {
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException exception) {
            return 0;
        }
    }

    private static String formatDateKey(Date date, TimeZone timeZone) {
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd", Locale.US);

        formatter.setTimeZone(timeZone);
        return formatter.format(date);
    }

    private static String formatTime(Date date, TimeZone timeZone) {
        SimpleDateFormat formatter = new SimpleDateFormat("HH:mm", Locale.US);

        formatter.setTimeZone(timeZone);
        return formatter.format(date);
    }

    private static String formatShortDate(String dateKey) {
        try {
            SimpleDateFormat parser = new SimpleDateFormat("yyyy-MM-dd", Locale.US);

            parser.setLenient(false);
            Date date = parser.parse(dateKey);

            return date == null ? dateKey : new SimpleDateFormat("d MMM", RU_LOCALE).format(date);
        } catch (Exception exception) {
            return dateKey;
        }
    }

    private static String addDateDays(String dateKey, int amount, TimeZone timeZone) {
        try {
            SimpleDateFormat parser = new SimpleDateFormat("yyyy-MM-dd", Locale.US);

            parser.setLenient(false);
            parser.setTimeZone(timeZone);
            Date date = parser.parse(dateKey);

            if (date == null) {
                return dateKey;
            }

            Calendar calendar = Calendar.getInstance(timeZone, Locale.US);

            calendar.setTime(date);
            calendar.add(Calendar.DAY_OF_YEAR, amount);
            return formatDateKey(calendar.getTime(), timeZone);
        } catch (Exception exception) {
            return dateKey;
        }
    }

    private static String formatUtc(Date date) {
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);

        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(date);
    }

    private static TimeZone resolveTimeZone(String timeZoneId) {
        String normalized = timeZoneId == null ? "" : timeZoneId.trim();

        if (normalized.isEmpty()) {
            return TimeZone.getDefault();
        }

        TimeZone timeZone = TimeZone.getTimeZone(normalized);

        return "GMT".equals(timeZone.getID()) && !"GMT".equalsIgnoreCase(normalized)
            ? TimeZone.getDefault()
            : timeZone;
    }

    private static void addLimited(
        List<WidgetTaskCandidate> destination,
        List<WidgetTaskCandidate> source
    ) {
        destination.addAll(source.subList(0, Math.min(MAX_TASKS_PER_SOURCE, source.size())));
    }

    private static final class DisplayedSchedule {
        final String plannedDate;
        final String plannedStartTime;
        final String plannedEndTime;

        DisplayedSchedule(String plannedDate, String plannedStartTime, String plannedEndTime) {
            this.plannedDate = plannedDate;
            this.plannedStartTime = plannedStartTime;
            this.plannedEndTime = plannedEndTime;
        }
    }

    private static final class SphereLookup {
        final Map<String, JSONObject> byId;
        final Map<String, JSONObject> byName;

        SphereLookup(Map<String, JSONObject> byId, Map<String, JSONObject> byName) {
            this.byId = byId;
            this.byName = byName;
        }
    }

    private static final class WidgetTaskCandidate {
        final String createdAt;
        final String dateBucket;
        final String plannedDate;
        final String plannedStartTime;
        final int priorityWeight;
        final int statusWeight;
        final String timeLabel;
        final JSONObject value;

        WidgetTaskCandidate(
            JSONObject value,
            String dateBucket,
            String timeLabel,
            int statusWeight,
            String plannedDate,
            String plannedStartTime,
            int priorityWeight,
            String createdAt
        ) {
            this.value = value;
            this.dateBucket = dateBucket;
            this.timeLabel = timeLabel;
            this.statusWeight = statusWeight;
            this.plannedDate = plannedDate;
            this.plannedStartTime = plannedStartTime;
            this.priorityWeight = priorityWeight;
            this.createdAt = createdAt;
        }

        static WidgetTaskCandidate supplemental(
            JSONObject value,
            String dateBucket,
            String timeLabel
        ) {
            return new WidgetTaskCandidate(value, dateBucket, timeLabel, 0, null, null, 0, "");
        }
    }
}
