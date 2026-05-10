package ru.chaotika.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;

public class PlannerWidgetContractTest {

    @Test
    public void parseSnapshot_acceptsCurrentSnapshot() {
        PlannerWidgetSnapshot snapshot = PlannerWidgetContract.parseSnapshot(createSnapshot("2026-05-09"));

        assertNotNull(snapshot);
        assertEquals("2026-05-09", snapshot.dateKey);
        assertEquals(2, snapshot.todayCount);
        assertEquals(1, snapshot.doneTodayCount);
        assertEquals(1, snapshot.overdueCount);
        assertEquals(3, snapshot.hiddenTaskCount);
        assertEquals(2, snapshot.tasks.size());
        assertEquals("task-overdue", snapshot.tasks.get(0).id);
        assertEquals("#AD4E2F", snapshot.tasks.get(0).color);
        assertEquals("svg:bell", snapshot.tasks.get(0).icon);
        assertEquals(true, snapshot.tasks.get(0).isOverdue);
        assertEquals("overdue", snapshot.tasks.get(0).visualTone);
        assertEquals("task-today", snapshot.tasks.get(1).id);
        assertEquals("#2F6F62", snapshot.tasks.get(1).color);
        assertEquals("🎯", snapshot.tasks.get(1).icon);
        assertEquals("09:00 - 10:00", snapshot.tasks.get(1).timeLabel);
        assertEquals("urgent", snapshot.tasks.get(1).visualTone);
    }

    @Test
    public void parseSnapshot_rejectsMissingOrOldContract() {
        assertNull(PlannerWidgetContract.parseSnapshot(null));
        assertNull(PlannerWidgetContract.parseSnapshot(""));
        assertNull(PlannerWidgetContract.parseSnapshot("{\"version\":2,\"dateKey\":\"2026-05-09\"}"));
    }

    @Test
    public void resolveState_reportsNoSnapshotStaleAndValidStates() {
        assertEquals(
            PlannerWidgetStateKind.NO_SNAPSHOT,
            PlannerWidgetContract.resolveState(null, "2026-05-09").kind
        );
        assertEquals(
            PlannerWidgetStateKind.STALE,
            PlannerWidgetContract.resolveState(createSnapshot("2026-05-08"), "2026-05-09").kind
        );
        assertEquals(
            PlannerWidgetStateKind.VALID,
            PlannerWidgetContract.resolveState(createSnapshot("2026-05-09"), "2026-05-09").kind
        );
    }

    @Test
    public void markTaskDone_removesTaskAndUpdatesSnapshotCounters() throws Exception {
        String nextSnapshot = PlannerWidgetContract.markTaskDone(
            createSnapshot("2026-05-09"),
            "task-overdue",
            "2026-05-09T10:00:00.000Z"
        );
        JSONObject value = new JSONObject(nextSnapshot);
        JSONArray tasks = value.getJSONArray("tasks");

        assertEquals(1, value.getInt("doneTodayCount"));
        assertEquals(0, value.getInt("overdueCount"));
        assertEquals(2, value.getInt("todayCount"));
        assertEquals(3, value.getInt("hiddenTaskCount"));
        assertEquals("2026-05-09T10:00:00.000Z", value.getString("generatedAt"));
        assertEquals(1, tasks.length());
        assertEquals("task-today", tasks.getJSONObject(0).getString("id"));
    }

    private static String createSnapshot(String dateKey) {
        return "{"
            + "\"version\":4,"
            + "\"dateKey\":\"" + dateKey + "\","
            + "\"generatedAt\":\"2026-05-09T09:00:00.000Z\","
            + "\"todayCount\":2,"
            + "\"doneTodayCount\":0,"
            + "\"overdueCount\":1,"
            + "\"hiddenTaskCount\":3,"
            + "\"tasks\":["
            + "{"
            + "\"id\":\"task-overdue\","
            + "\"color\":\"#ad4e2f\","
            + "\"icon\":\"svg:bell\","
            + "\"title\":\"Просроченная\","
            + "\"timeLabel\":null,"
            + "\"isOverdue\":true,"
            + "\"visualTone\":\"overdue\""
            + "},"
            + "{"
            + "\"id\":\"task-today\","
            + "\"color\":\"#2f6f62\","
            + "\"icon\":\"🎯\","
            + "\"title\":\"Фокус\","
            + "\"timeLabel\":\"09:00 - 10:00\","
            + "\"isOverdue\":false,"
            + "\"visualTone\":\"urgent\""
            + "}"
            + "]"
            + "}";
    }
}
