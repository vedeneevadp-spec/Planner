package ru.chaotika.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.util.Date;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class PlannerWidgetSnapshotFactoryTest {

    @Test
    public void buildSnapshot_mergesFreshPlannerSelfCareAndCleaningData() throws Exception {
        JSONArray tasks = new JSONArray()
            .put(task("task-today", "План на день", "todo", "2026-08-24", null, null))
            .put(task("task-overdue", "Просроченная", "in_progress", "2026-08-23", null, null))
            .put(
                task("task-done", "Уже выполнено", "done", "2026-08-24", null, null)
                    .put("completedAt", "2026-08-24T02:00:00.000Z")
            );
        JSONArray spheres = new JSONArray().put(
            new JSONObject()
                .put("id", "sphere-1")
                .put("name", "Личное")
                .put("color", "#123abc")
                .put("icon", "🎯")
        );
        JSONObject selfCare = new JSONObject()
            .put("overdueItems", new JSONArray())
            .put(
                "todayItems",
                new JSONArray()
                    .put(selfCareEntry("care-open", "Уход", "scheduled", false))
                    .put(selfCareEntry("care-done", "Маникюр", "done", false))
                    .put(selfCareEntry("care-completed", "Вес", "scheduled", true))
            )
            .put("flexibleGoals", new JSONArray());
        JSONObject cleaning = new JSONObject()
            .put(
                "items",
                new JSONArray().put(cleaningEntry("clean-1", "Кухня", true, "normal"))
            )
            .put("generalItems", new JSONArray());
        Date now = new Date(
            PlannerWidgetSnapshotFactory.parseInstantMillis("2026-08-24T03:00:00.000Z")
        );
        JSONObject snapshot = new JSONObject(
            PlannerWidgetSnapshotFactory.buildSnapshot(
                tasks,
                spheres,
                selfCare,
                cleaning,
                "Asia/Novosibirsk",
                now
            )
        );
        JSONArray widgetTasks = snapshot.getJSONArray("tasks");

        assertEquals("2026-08-24", snapshot.getString("dateKey"));
        assertEquals(1, snapshot.getInt("todayCount"));
        assertEquals(1, snapshot.getInt("doneTodayCount"));
        assertEquals(1, snapshot.getInt("overdueCount"));
        assertEquals(4, widgetTasks.length());
        assertEquals("task-overdue", widgetTasks.getJSONObject(0).getString("id"));
        assertEquals("cleaning:clean-1", widgetTasks.getJSONObject(1).getString("id"));
        assertEquals("task-today", widgetTasks.getJSONObject(2).getString("id"));
        assertEquals("self-care:care-open", widgetTasks.getJSONObject(3).getString("id"));
        assertEquals("#123ABC", widgetTasks.getJSONObject(2).getString("color"));
        assertFalse(snapshot.toString().contains("Маникюр"));
        assertFalse(snapshot.toString().contains("Вес"));
    }

    @Test
    public void buildSnapshot_convertsFixedZoneScheduleIntoWidgetTimeZone() throws Exception {
        JSONObject fixedTask = task(
            "fixed-task",
            "Созвон",
            "todo",
            "2026-08-23",
            "20:00",
            "21:00"
        ).put(
            "schedule",
            new JSONObject()
                .put("kind", "fixed_zone_datetime")
                .put("instantUtc", "2026-08-24T02:30:00.000Z")
                .put("localTime", "20:00")
        );
        Date now = new Date(
            PlannerWidgetSnapshotFactory.parseInstantMillis("2026-08-24T01:00:00.000Z")
        );
        JSONObject snapshot = new JSONObject(
            PlannerWidgetSnapshotFactory.buildSnapshot(
                new JSONArray().put(fixedTask),
                new JSONArray(),
                emptySelfCare(),
                emptyCleaning(),
                "Asia/Novosibirsk",
                now
            )
        );
        JSONObject task = snapshot.getJSONArray("tasks").getJSONObject(0);

        assertEquals("today", task.getString("dateBucket"));
        assertEquals("09:30 - 10:30", task.getString("timeLabel"));
        assertEquals("Созвон", task.getString("title"));
    }

    @Test
    public void parseInstantMillis_supportsOffsetsAndFractionalSeconds() {
        Long utc = PlannerWidgetSnapshotFactory.parseInstantMillis("2026-08-24T03:00:00.123456Z");
        Long offset = PlannerWidgetSnapshotFactory.parseInstantMillis("2026-08-24T10:00:00.123+07:00");

        assertNotNull(utc);
        assertEquals(utc, offset);
        assertEquals(null, PlannerWidgetSnapshotFactory.parseInstantMillis("not-a-date"));
    }

    @Test
    public void generatedRefreshRotationId_isUuidV7() {
        String requestId = PlannerWidgetUuidV7.generate();

        assertTrue(
            requestId.matches(
                "^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
            )
        );
    }

    private static JSONObject task(
        String id,
        String title,
        String status,
        String plannedDate,
        String plannedStartTime,
        String plannedEndTime
    ) throws Exception {
        return new JSONObject()
            .put("id", id)
            .put("title", title)
            .put("status", status)
            .put("plannedDate", plannedDate)
            .put("plannedStartTime", plannedStartTime == null ? JSONObject.NULL : plannedStartTime)
            .put("plannedEndTime", plannedEndTime == null ? JSONObject.NULL : plannedEndTime)
            .put("completedAt", JSONObject.NULL)
            .put("createdAt", "2026-08-20T03:00:00.000Z")
            .put("importance", "not_important")
            .put("urgency", "not_urgent")
            .put("icon", "")
            .put("sphereId", "sphere-1")
            .put("projectId", JSONObject.NULL)
            .put("project", "Личное");
    }

    private static JSONObject selfCareEntry(
        String id,
        String title,
        String status,
        boolean completed
    ) throws Exception {
        return new JSONObject()
            .put(
                "item",
                new JSONObject()
                    .put("id", id)
                    .put("title", title)
                    .put("type", "ritual")
                    .put("isArchived", false)
                    .put("isActive", true)
                    .put("color", "#B9B3FF")
                    .put("icon", "♥")
            )
            .put(
                "occurrence",
                new JSONObject()
                    .put("id", id)
                    .put("status", status)
                    .put("scheduledFor", "2026-08-24")
                    .put("dueAt", JSONObject.NULL)
                    .put("reminderTimeZone", "Asia/Novosibirsk")
            )
            .put("completion", completed ? new JSONObject().put("id", "completion-" + id) : JSONObject.NULL)
            .put("appointment", JSONObject.NULL)
            .put("courseDetails", JSONObject.NULL)
            .put("flexibleProgress", JSONObject.NULL)
            .put("scheduleRule", JSONObject.NULL);
    }

    private static JSONObject cleaningEntry(
        String id,
        String title,
        boolean overdue,
        String priority
    ) throws Exception {
        return new JSONObject()
            .put("isOverdue", overdue)
            .put(
                "task",
                new JSONObject()
                    .put("id", id)
                    .put("title", title)
                    .put("priority", priority)
            );
    }

    private static JSONObject emptySelfCare() throws Exception {
        return new JSONObject()
            .put("overdueItems", new JSONArray())
            .put("todayItems", new JSONArray())
            .put("flexibleGoals", new JSONArray());
    }

    private static JSONObject emptyCleaning() throws Exception {
        return new JSONObject()
            .put("items", new JSONArray())
            .put("generalItems", new JSONArray());
    }
}
