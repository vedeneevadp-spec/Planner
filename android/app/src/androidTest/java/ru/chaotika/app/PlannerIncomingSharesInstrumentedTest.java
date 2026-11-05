package ru.chaotika.app;

import static org.junit.Assert.*;

import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.CalendarContract;
import android.text.SpannableString;
import androidx.test.core.app.ActivityScenario;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.JSObject;
import java.util.UUID;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PlannerIncomingSharesInstrumentedTest {
    private final Context context = ApplicationProvider.getApplicationContext();
    private final PlannerIncomingDraftQueue queue = PlannerIncomingShareStore.QUEUE;

    @Before @After
    public void clearQueue() throws Exception {
        JSObject draft;
        while ((draft = queue.peek(context)) != null) {
            queue.acknowledge(context, draft.getString("requestId"));
        }
    }

    private Intent share(String text) {
        return new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text);
    }

    private boolean resolves(Intent intent) {
        intent.setPackage(context.getPackageName());
        return !context.getPackageManager().queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY).isEmpty();
    }

    @Test public void chooserAcceptsPlainTextAndLeavesAttachmentsToOtherApps() {
        assertTrue(resolves(share("Забрать посылку")));
        assertFalse(resolves(share("image").setType("image/png")));
        assertFalse(resolves(share("list").setAction(Intent.ACTION_SEND_MULTIPLE)));
    }

    @Test public void acceptsLinksAndStyledTextWithoutFollowingContentUris() throws Exception {
        Intent browser = share("https://shop.example/mug").putExtra(Intent.EXTRA_SUBJECT, "Термокружка");
        JSObject draft = PlannerIncomingShareStore.parse(browser);
        assertEquals("https://shop.example/mug", draft.getString("text"));
        assertEquals("Термокружка", draft.getString("subject"));
        assertEquals(7, UUID.fromString(draft.getString("requestId")).version());
        Intent chat = new Intent(Intent.ACTION_SEND).setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, new SpannableString("  Забрать посылку  "));
        assertEquals("Забрать посылку", PlannerIncomingShareStore.parse(chat).getString("text"));
        chat.removeExtra(Intent.EXTRA_TEXT);
        chat.setClipData(ClipData.newPlainText("snippet", "Через буфер Android"));
        assertEquals("Через буфер Android", PlannerIncomingShareStore.parse(chat).getString("text"));
        chat.setClipData(ClipData.newRawUri("file", Uri.parse("content://example/file")));
        assertNull(PlannerIncomingShareStore.parse(chat));
    }

    @Test public void ignoresHistoryBlankMalformedAndOversizePayloadEdges() throws Exception {
        assertNull(PlannerIncomingShareStore.parse(share("old").addFlags(Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY)));
        assertNull(PlannerIncomingShareStore.parse(share("   ")));
        assertNull(PlannerIncomingShareStore.parse(share("file").putExtra(Intent.EXTRA_STREAM, Uri.parse("content://example/file"))));
        assertNull(PlannerIncomingShareStore.parse(share("text").putExtra(Intent.EXTRA_TEXT, 12)));
        String prefix = new String(new char[9999]).replace('\0', 'a');
        JSObject limited = PlannerIncomingShareStore.parse(share(prefix + "🌱b"));
        assertEquals(prefix, limited.getString("text"));
    }

    @Test public void capturesColdAndWarmSharesOnceAndRetainsTheirOrderOnRecreation() throws Exception {
        Intent cold = share("Первое").setClass(context, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(cold)) {
            String firstId = queue.peek(context).getString("requestId");
            activity.onActivity(current -> current.onNewIntent(share("Второе").setClass(context, MainActivity.class)));
            activity.recreate();
            assertEquals(firstId, queue.peek(context).getString("requestId"));
            queue.acknowledge(context, firstId);
            queue.acknowledge(context, firstId);
            JSObject second = queue.peek(context);
            assertEquals("Второе", second.getString("text"));
            assertNotEquals(firstId, second.getString("requestId"));
            queue.acknowledge(context, second.getString("requestId"));
            assertNull(queue.peek(context));
        }
    }

    @Test public void shareAndCalendarDraftsCanBeAcknowledgedIndependently() throws Exception {
        Intent calendar = new Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, "Встреча");
        PlannerCalendarEventStore.receive(context, calendar);
        String calendarId = PlannerCalendarEventStore.peek(context).getString("requestId");
        try {
            PlannerIncomingShareStore.receive(context, share("Забрать посылку"));
            String shareId = queue.peek(context).getString("requestId");
            queue.acknowledge(context, shareId);
            assertNull(queue.peek(context));
            assertEquals(calendarId, PlannerCalendarEventStore.peek(context).getString("requestId"));
        } finally {
            PlannerCalendarEventStore.acknowledge(context, calendarId);
        }
    }
}
