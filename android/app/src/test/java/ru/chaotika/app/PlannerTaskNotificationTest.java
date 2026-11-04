package ru.chaotika.app;

import static org.junit.Assert.*;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;
import org.junit.Test;

public class PlannerTaskNotificationTest {
    @Test
    public void acceptsOnlyAccountScopedTaskReminders() {
        Map<String, String> data = data();
        PlannerTaskNotification entry = PlannerTaskNotification.fromPush(data, "https://chaotika.ru");
        assertNotNull(entry);
        assertEquals("user-1:workspace-1:task-1", entry.key());
        data.put("type", "self-care-reminder");
        assertNull(PlannerTaskNotification.fromPush(data, "https://chaotika.ru"));
        data.put("type", "task-reminder");
        data.remove("recipientUserId");
        assertNull(PlannerTaskNotification.fromPush(data, "https://chaotika.ru"));
    }

    @Test
    public void rejectsPathInjectionAndMissingProtocolVersion() {
        Map<String, String> data = data();
        data.put("taskId", "../another-account");
        assertNull(PlannerTaskNotification.fromPush(data, "https://chaotika.ru"));
        data = data();
        data.remove("actionsVersion");
        assertNull(PlannerTaskNotification.fromPush(data, "https://chaotika.ru"));
    }

    @Test
    public void snoozePreservesTargetAndUsesFreshReminderText() {
        PlannerTaskNotification entry = PlannerTaskNotification.fromPush(data(), "https://chaotika.ru");
        PlannerTaskNotification snoozed = entry.withState(PlannerTaskNotification.SNOOZED, 1000 + PlannerTaskNotification.SNOOZE_MILLIS);
        PlannerTaskNotification restored = PlannerTaskNotification.parse(snoozed.toJson().toString());
        assertEquals(entry.key(), restored.key());
        assertEquals(entry.instanceId(), restored.instanceId());
        assertEquals(901000, restored.wakeAt());
        PlannerTaskNotification wake = restored.withState(PlannerTaskNotification.READY, 0);
        assertEquals("Позвонить", wake.body());
        assertEquals("Напоминание", wake.title());
        assertEquals(0, wake.wakeAt());
    }

    @Test
    public void durablePendingActionKeepsTheOriginalVersion() {
        PlannerTaskNotification entry = PlannerTaskNotification.fromPush(data(), "https://chaotika.ru")
            .withState(PlannerTaskNotification.PENDING, 0).withExpectedVersion(4);
        PlannerTaskNotification restored = PlannerTaskNotification.parse(entry.toJson().toString());
        assertEquals(4, restored.expectedVersion());
        assertEquals(PlannerTaskNotification.PENDING, restored.state());
        assertEquals("https://chaotika.ru", restored.apiBaseUrl());
    }

    @Test
    public void staleOrMissingAuthCannotUseAnotherAccountsReminder() {
        PlannerTaskNotification entry = PlannerTaskNotification.fromPush(data(), "https://chaotika.ru");
        assertFalse(entry.belongsTo(null));
        assertFalse(entry.belongsTo(new PlannerWidgetAuthSession("access", "a@example.com", "date", "refresh", null, "other-user")));
        assertTrue(entry.belongsTo(new PlannerWidgetAuthSession("access", "a@example.com", "date", "refresh", null, "user-1")));
    }

    @Test
    public void completionIsIdempotentAndDoesNotOverwriteNewerOrInactiveTasks() throws Exception {
        assertEquals(PlannerTaskCompletion.Decision.COMPLETE, PlannerTaskCompletion.decide(task("todo", 4), 0));
        assertEquals(PlannerTaskCompletion.Decision.COMPLETE, PlannerTaskCompletion.decide(task("in_progress", 4), 4));
        assertEquals(PlannerTaskCompletion.Decision.ALREADY_DONE, PlannerTaskCompletion.decide(task("done", 5), 4));
        assertEquals(PlannerTaskCompletion.Decision.CONFLICT, PlannerTaskCompletion.decide(task("todo", 5), 4));
        assertEquals(PlannerTaskCompletion.Decision.INACTIVE, PlannerTaskCompletion.decide(task("archived", 4), 4));
        assertEquals(PlannerTaskCompletion.Decision.INACTIVE, PlannerTaskCompletion.decide(task("ready_for_review", 4), 4));
        assertEquals(PlannerTaskCompletion.Decision.CONFLICT, PlannerTaskCompletion.decide(task("todo", 0), 0));
    }

    private JSONObject task(String status, int version) throws Exception {
        return new JSONObject().put("status", status).put("version", version);
    }

    static Map<String, String> data() {
        Map<String, String> data = new HashMap<>();
        data.put("type", "task-reminder"); data.put("actionsVersion", "1");
        data.put("recipientUserId", "user-1"); data.put("workspaceId", "workspace-1");
        data.put("taskId", "task-1"); data.put("taskTitle", "Позвонить");
        data.put("title", "Скоро задача"); data.put("body", "Через 15 минут: Позвонить");
        data.put("notificationTag", "task-reminder:reminder-1");
        return data;
    }
}
