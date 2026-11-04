package ru.chaotika.app;

import static org.junit.Assert.*;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobScheduler;
import android.content.Context;
import android.os.ParcelFileDescriptor;
import android.service.notification.StatusBarNotification;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.BooleanSupplier;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PlannerTaskNotificationInstrumentedTest {
    private Context context;
    private TestApi api;

    @Before
    public void setUp() throws Exception {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        shell("pm grant " + context.getPackageName() + " android.permission.POST_NOTIFICATIONS");
        PlannerTaskNotifications.clearAll(context);
        api = new TestApi();
        assertTrue(PlannerWidgetStorage.writeSyncConfig(context, new PlannerWidgetSyncConfig(api.url(), "workspace-1", "UTC")));
        setSession("user-1", "2099-01-01T00:00:00.000Z");
    }

    @After
    public void tearDown() throws Exception {
        shell("cmd statusbar collapse");
        PlannerTaskNotifications.clearAll(context);
        PlannerSecureStorage.remove(context, "planner.auth.planner.auth.session", "CapacitorStorage");
        PlannerWidgetStorage.clearSyncConfig(context);
        api.close();
    }

    @Test
    public void notificationShowsBothActionsAndSnoozeOnlySchedulesALocalReminder() throws Exception {
        PlannerTaskNotification entry = show();
        Notification notification = notification();
        assertEquals("Готово", notification.actions[0].title.toString());
        assertEquals("Через 15 минут", notification.actions[1].title.toString());
        shell("cmd statusbar expand-notifications");
        // Posting is asynchronous; allow SystemUI to render before capturing the preview.
        Thread.sleep(2500);
        android.graphics.Bitmap screenshot = InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();
        try (java.io.FileOutputStream output = new java.io.FileOutputStream(
            new java.io.File(context.getExternalFilesDir(null), "notification-actions-preview.png"))) {
            assertTrue(screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, output));
        }
        screenshot.recycle();
        long before = System.currentTimeMillis();
        notification.actions[1].actionIntent.send();
        await(() -> PlannerTaskNotification.SNOOZED.equals(PlannerTaskNotificationStore.find(context, entry.key()).state()));
        PlannerTaskNotification snoozed = PlannerTaskNotificationStore.find(context, entry.key());
        assertTrue(snoozed.wakeAt() >= before + 900_000);
        assertTrue(snoozed.wakeAt() < System.currentTimeMillis() + 901_000);
        assertEquals(0, api.requests.size());
        assertEquals(0, context.getSystemService(NotificationManager.class).getActiveNotifications().length);

        // Exercise the receiver after restoring persisted snooze data, without a 15 minute wait.
        PlannerTaskNotification due = snoozed.withState(PlannerTaskNotification.SNOOZED, System.currentTimeMillis() - 1);
        assertTrue(PlannerTaskNotificationStore.replace(context, snoozed, due));
        PlannerTaskNotifications.actionIntent(context, due, PlannerTaskNotifications.WAKE).send();
        await(() -> context.getSystemService(NotificationManager.class).getActiveNotifications().length == 1);
        assertEquals("Проверить задачу", notification().extras.getCharSequence(Notification.EXTRA_TEXT).toString());
        assertEquals(2, notification().actions.length);
        assertEquals(0, api.requests.size());
    }

    @Test
    public void duplicateDeliveryDoesNotReplaceTheVisibleReminderOrItsActions() throws Exception {
        PlannerTaskNotification original = show();
        PendingIntent snooze = notification().actions[1].actionIntent;
        PlannerTaskNotification duplicate = show();
        assertEquals(original.instanceId(), duplicate.instanceId());
        snooze.send();
        await(() -> PlannerTaskNotification.SNOOZED.equals(PlannerTaskNotificationStore.find(context, original.key()).state()));
        show();
        assertEquals(PlannerTaskNotification.SNOOZED, PlannerTaskNotificationStore.find(context, original.key()).state());
        assertEquals(0, context.getSystemService(NotificationManager.class).getActiveNotifications().length);
        assertEquals(0, api.requests.size());
    }

    @Test
    public void doneWorksWithoutOpeningAnActivityAndRepeatedTapsAreIdempotent() throws Exception {
        PlannerTaskNotification entry = show();
        PendingIntent done = notification().actions[0].actionIntent;
        done.send(); done.send();
        forceJob();
        await(() -> PlannerTaskNotificationStore.find(context, entry.key()) == null);
        assertEquals(1, api.patchCount());
        assertEquals("done", api.taskStatus);
        assertTrue(api.requests.stream().anyMatch(request -> request.contains("\"expectedVersion\":4")));
        assertTrue(api.requests.stream().allMatch(request -> request.contains("x-workspace-id: workspace-1")));
        done.send();
        assertEquals(1, api.patchCount());
    }

    @Test
    public void retryableFailurePersistsCompletionAndRetriesWithTheSameVersion() throws Exception {
        api.failPatch = true;
        PlannerTaskNotification entry = show();
        notification().actions[0].actionIntent.send();
        forceJob();
        await(() -> api.patchCount() >= 1);
        PlannerTaskNotification pending = PlannerTaskNotificationStore.find(context, entry.key());
        assertEquals(PlannerTaskNotification.PENDING, pending.state());
        assertEquals(4, pending.expectedVersion());
        assertEquals("todo", api.taskStatus);
        api.failPatch = false;
        Thread.sleep(500);
        forceJob();
        await(() -> PlannerTaskNotificationStore.find(context, entry.key()) == null);
        assertEquals("done", api.taskStatus);
        assertTrue(api.requests.stream().filter(request -> request.startsWith("PATCH")).allMatch(request -> request.contains("\"expectedVersion\":4")));
    }

    @Test
    public void newerTaskVersionIsNotOverwrittenOnRetry() throws Exception {
        PlannerTaskNotification entry = show();
        PlannerTaskNotification pending = entry.withState(PlannerTaskNotification.PENDING, 0).withExpectedVersion(3);
        assertTrue(PlannerTaskNotificationStore.replace(context, entry, pending));
        PlannerTaskNotificationScheduler.scheduleJob(context);
        forceJob();
        await(() -> PlannerTaskNotification.ERROR.equals(PlannerTaskNotificationStore.find(context, entry.key()).state()));
        assertEquals(0, api.patchCount());
        assertEquals("todo", api.taskStatus);
    }

    @Test
    public void completedAndDeletedTasksDoNotTriggerASecondMutation() throws Exception {
        api.taskStatus = "done";
        PlannerTaskNotification entry = show();
        String firstKey = entry.key();
        notification().actions[0].actionIntent.send();
        forceJob();
        await(() -> PlannerTaskNotificationStore.find(context, firstKey) == null);
        assertEquals(0, api.patchCount());

        api.deleted = true;
        entry = show();
        String key = entry.key();
        notification().actions[0].actionIntent.send();
        forceJob();
        await(() -> PlannerTaskNotificationStore.find(context, key) == null);
        assertEquals(0, api.patchCount());
    }

    @Test
    public void oldNotificationCannotActAfterSwitchingAccountsOrLoggingOut() throws Exception {
        PlannerTaskNotification entry = show();
        PendingIntent done = notification().actions[0].actionIntent;
        setSession("other-user", "2099-01-01T00:00:00.000Z");
        PlannerTaskNotificationScheduler.restore(context);
        done.send();
        assertNull(PlannerTaskNotificationStore.find(context, entry.key()));
        assertEquals(0, api.requests.size());
        setSession("user-1", "2099-01-01T00:00:00.000Z");
        entry = show(); done = notification().actions[0].actionIntent;
        PlannerSecureStorage.remove(context, "planner.auth.planner.auth.session", "CapacitorStorage");
        PlannerTaskNotifications.clearAll(context);
        done.send();
        assertNull(PlannerTaskNotificationStore.find(context, entry.key()));
        assertEquals(0, api.requests.size());
    }

    @Test
    public void expiredAccessTokenIsRefreshedBeforeCompletion() throws Exception {
        setSession("user-1", "2020-01-01T00:00:00.000Z");
        PlannerTaskNotification entry = show();
        notification().actions[0].actionIntent.send();
        forceJob();
        await(() -> PlannerTaskNotificationStore.find(context, entry.key()) == null);
        assertEquals(1, api.patchCount());
        assertTrue(api.requests.get(0).startsWith("POST /api/v1/auth/refresh"));
        assertEquals("refreshed-access", PlannerWidgetAuthSessionStore.read(context).accessToken);
    }

    private PlannerTaskNotification show() {
        Map<String, String> data = new HashMap<>();
        data.put("type", "task-reminder"); data.put("actionsVersion", "1");
        data.put("recipientUserId", "user-1"); data.put("workspaceId", "workspace-1"); data.put("taskId", "task-1");
        data.put("title", "Скоро задача"); data.put("body", "Через 15 минут: Проверить задачу");
        data.put("taskTitle", "Проверить задачу"); data.put("notificationTag", "task-reminder:1");
        PlannerMessagingService.renderTaskReminder(context, data);
        PlannerTaskNotification entry = PlannerTaskNotificationStore.find(context, "user-1:workspace-1:task-1");
        assertNotNull(entry);
        return entry;
    }

    private Notification notification() throws Exception {
        await(() -> context.getSystemService(NotificationManager.class).getActiveNotifications().length == 1);
        StatusBarNotification[] active = context.getSystemService(NotificationManager.class).getActiveNotifications();
        return active[0].getNotification();
    }

    private void setSession(String userId, String expiry) {
        PlannerWidgetAuthSession session = new PlannerWidgetAuthSession("test-access", "test@example.invalid", expiry, "test-refresh", null, userId);
        assertTrue(PlannerSecureStorage.putString(context, "planner.auth.planner.auth.session", session.toJson().toString(), "CapacitorStorage"));
    }

    private void forceJob() throws Exception {
        // The tap schedules the job asynchronously on the main thread.
        Thread.sleep(200);
        shell("cmd jobscheduler run -f " + context.getPackageName() + " " + PlannerTaskNotificationScheduler.JOB_ID);
    }

    private static void await(BooleanSupplier condition) throws Exception {
        long deadline = System.currentTimeMillis() + 20_000;
        while (!condition.getAsBoolean() && System.currentTimeMillis() < deadline) Thread.sleep(50);
        assertTrue("Timed out waiting for notification action", condition.getAsBoolean());
    }

    private static void shell(String command) throws Exception {
        try (ParcelFileDescriptor descriptor = InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);
             java.io.InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(descriptor)) {
            byte[] buffer = new byte[1024]; while (input.read(buffer) != -1) { /* drain */ }
        }
    }

    private static class TestApi implements AutoCloseable {
        final ServerSocket server;
        final Thread thread;
        final CopyOnWriteArrayList<String> requests = new CopyOnWriteArrayList<>();
        volatile String taskStatus = "todo";
        volatile boolean failPatch;
        volatile boolean deleted;
        volatile boolean closed;

        TestApi() throws Exception {
            server = new ServerSocket(0);
            thread = new Thread(() -> {
                while (!closed) {
                    try (Socket socket = server.accept()) { respond(socket); }
                    catch (Exception exception) { if (!closed) throw new RuntimeException(exception); }
                }
            });
            thread.start();
        }
        String url() { return "http://127.0.0.1:" + server.getLocalPort(); }
        long patchCount() { return requests.stream().filter(request -> request.startsWith("PATCH")).count(); }
        private void respond(Socket socket) throws Exception {
            socket.setSoTimeout(5000);
            BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
            String first = reader.readLine();
            StringBuilder request = new StringBuilder(first).append('\n');
            int length = 0;
            for (String line; (line = reader.readLine()) != null && !line.isEmpty();) {
                request.append(line.toLowerCase(java.util.Locale.ROOT)).append('\n');
                if (line.toLowerCase(java.util.Locale.ROOT).startsWith("content-length:")) length = Integer.parseInt(line.substring(15).trim());
            }
            char[] body = new char[length]; int offset = 0;
            while (offset < length) { int read = reader.read(body, offset, length - offset); if (read < 0) break; offset += read; }
            request.append(body);
            int status = 200;
            String response;
            if (first.startsWith("POST /api/v1/auth/refresh")) {
                response = "{\"accessToken\":\"refreshed-access\",\"refreshToken\":\"refreshed-refresh\",\"expiresAt\":\"2099-01-01T00:00:00.000Z\",\"user\":{\"id\":\"user-1\",\"email\":\"test@example.invalid\"}}";
            } else {
                if (deleted) status = 404;
                else if (first.startsWith("PATCH")) { if (failPatch) status = 503; else taskStatus = "done"; }
                response = new JSONObject().put("id", "task-1").put("status", taskStatus).put("version", taskStatus.equals("done") ? 5 : 4).toString();
            }
            requests.add(request.toString());
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            OutputStream output = socket.getOutputStream();
            output.write(("HTTP/1.1 " + status + " Test\r\nContent-Type: application/json\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            output.write(bytes); output.flush();
        }
        public void close() throws Exception { closed = true; server.close(); thread.join(2000); }
    }
}
