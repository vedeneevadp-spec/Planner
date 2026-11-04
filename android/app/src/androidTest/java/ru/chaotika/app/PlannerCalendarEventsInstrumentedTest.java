package ru.chaotika.app;

import static org.junit.Assert.*;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.CalendarContract;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.JSObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PlannerCalendarEventsInstrumentedTest {
    private final Context context = ApplicationProvider.getApplicationContext();

    @Before @After
    public void clearQueue() throws Exception {
        JSObject pending;
        while ((pending = PlannerCalendarEventStore.peek(context)) != null) {
            PlannerCalendarEventStore.acknowledge(context, pending.getString("requestId"));
        }
    }

    private Intent event(String title) {
        return new Intent(Intent.ACTION_INSERT)
            .setDataAndType(CalendarContract.Events.CONTENT_URI, "vnd.android.cursor.dir/event")
            .putExtra(CalendarContract.Events.TITLE, title)
            .putExtra(CalendarContract.Events.DESCRIPTION, "Контекст встречи")
            .putExtra(CalendarContract.Events.EVENT_LOCATION, "Переговорная")
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, 1793878800000L)
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, 1793882400000L);
    }

    @Test public void resolvesStandardAndSmartActionIntentsToChaotika() {
        for (String action : new String[] { Intent.ACTION_INSERT, Intent.ACTION_INSERT_OR_EDIT }) {
            for (String type : new String[] { "vnd.android.cursor.dir/event", "vnd.android.cursor.item/event" }) {
                Intent intent = new Intent(action).setType(type).setPackage(context.getPackageName());
                assertFalse(context.getPackageManager().queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY).isEmpty());
            }
        }
        assertFalse(context.getPackageManager().queryIntentActivities(event("Встреча").setPackage(context.getPackageName()), PackageManager.MATCH_DEFAULT_ONLY).isEmpty());
    }

    @Test public void readsFieldsAndDoesNotConsumeUntilAcknowledged() throws Exception {
        PlannerCalendarEventStore.receive(context, event("Встреча"));
        JSObject first = PlannerCalendarEventStore.peek(context);
        assertEquals("Встреча", first.getString("title"));
        assertEquals("Контекст встречи", first.getString("description"));
        assertEquals("Переговорная", first.getString("location"));
        assertEquals(1793878800000L, first.getLong("beginTime"));
        assertEquals(first.getString("requestId"), PlannerCalendarEventStore.peek(context).getString("requestId"));
        PlannerCalendarEventStore.acknowledge(context, first.getString("requestId"));
        assertNull(PlannerCalendarEventStore.peek(context));
    }

    @Test public void coldLaunchAndActivityRecreationRetainExactlyOneDraft() throws Exception {
        Intent intent = event("Один черновик")
            .setClass(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(intent)) {
            String requestId = PlannerCalendarEventStore.peek(context).getString("requestId");
            activity.recreate();
            assertEquals(requestId, PlannerCalendarEventStore.peek(context).getString("requestId"));
            PlannerCalendarEventStore.acknowledge(context, requestId);
            assertNull(PlannerCalendarEventStore.peek(context));
        }
    }

    @Test public void keepsLaterEventsWhenAnEarlierDraftIsAcknowledgedTwice() throws Exception {
        PlannerCalendarEventStore.receive(context, event("Первое"));
        String id = PlannerCalendarEventStore.peek(context).getString("requestId");
        PlannerCalendarEventStore.receive(context, event("Второе"));
        PlannerCalendarEventStore.acknowledge(context, id);
        PlannerCalendarEventStore.acknowledge(context, id);
        assertEquals("Второе", PlannerCalendarEventStore.peek(context).getString("title"));
    }

    @Test public void ignoresHistoryReplayAndUnrelatedIntents() throws Exception {
        PlannerCalendarEventStore.receive(context, event("Повтор").addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY));
        PlannerCalendarEventStore.receive(context, new Intent(Intent.ACTION_SEND).setType("text/plain"));
        PlannerCalendarEventStore.receive(context, new Intent(Intent.ACTION_INSERT).setType("vnd.android.cursor.dir/contact"));
        assertNull(PlannerCalendarEventStore.peek(context));
    }

    @Test public void handlesMissingAndWrongExtraTypesWithoutInventingDates() throws Exception {
        Intent intent = new Intent(Intent.ACTION_INSERT_OR_EDIT).setType("vnd.android.cursor.item/event")
            .putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, "tomorrow")
            .putExtra(CalendarContract.Events.TITLE, 42)
            .putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, true);
        JSObject parsed = PlannerCalendarEventStore.parse(intent);
        assertEquals("", parsed.getString("title"));
        assertTrue(parsed.isNull("beginTime"));
        assertTrue(parsed.getBool("allDay"));
        assertNotNull(PlannerCalendarEventStore.parse(new Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)));
    }

    @Test public void boundsExternalPayloadAndRejectsReversedEndTimes() throws Exception {
        Intent intent = event(new String(new char[1000]).replace('\0', 'x'))
            .putExtra(CalendarContract.EXTRA_EVENT_END_TIME, 1L);
        JSObject parsed = PlannerCalendarEventStore.parse(intent);
        assertEquals(240, parsed.getString("title").length());
        assertTrue(parsed.isNull("endTime"));
    }
}
