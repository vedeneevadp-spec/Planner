package ru.chaotika.app;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.core.app.ApplicationProvider;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.Collections;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PlannerWidgetStorageInstrumentedTest {
    private final Context context = ApplicationProvider.getApplicationContext();

    @Before @After public void clearQueue() {
        context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).edit()
            .remove("planner.widget.sync.config")
            .remove("planner.widget.pending-completed-task-ids")
            .remove("planner.widget.pending.writeEpoch").commit();
    }

    @Test public void staleAcknowledgementCannotRemoveTheSameTaskFromANewGeneration() {
        String id = "0198a620-1d00-7000-8000-000000000001";
        assertTrue(PlannerWidgetStorage.writeSyncConfig(context,
            new PlannerWidgetSyncConfig("https://example.test", "workspace", "UTC", "0")));
        assertTrue(PlannerWidgetStorage.storePendingCompletedTaskId(context, id));
        assertTrue(PlannerWidgetStorage.writeSyncConfig(context,
            new PlannerWidgetSyncConfig("https://example.test", "workspace", "UTC", "1")));
        assertTrue(PlannerWidgetStorage.readPendingCompletedTaskIds(context).isEmpty());
        assertTrue(PlannerWidgetStorage.storePendingCompletedTaskId(context, id));
        PlannerWidgetStorage.ackPendingCompletedTaskIds(context, Collections.singletonList(id), "0");
        assertEquals(Collections.singletonList(id), PlannerWidgetStorage.readPendingCompletedTaskIds(context));
        PlannerWidgetStorage.ackPendingCompletedTaskIds(context, Collections.singletonList(id), "1");
        assertTrue(PlannerWidgetStorage.readPendingCompletedTaskIds(context).isEmpty());
    }
}
