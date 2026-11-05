package ru.chaotika.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private boolean initializingBridge;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        PlannerAppUpgradeCleanup.run(this);
        registerPlugin(PlannerAuthStoragePlugin.class);
        registerPlugin(PlannerBackupFilesPlugin.class);
        registerPlugin(PlannerWidgetPlugin.class);
        registerPlugin(PlannerAppSettingsPlugin.class);
        registerPlugin(PlannerAppUpdatesPlugin.class);
        registerPlugin(PlannerCalendarEventsPlugin.class);
        if (savedInstanceState == null) {
            PlannerCalendarEventStore.receive(this, getIntent());
        }
        // BridgeActivity.load() calls our onNewIntent with the launch intent again.
        // Capture it once above, and do not re-import it on activity recreation.
        initializingBridge = true;
        try {
            super.onCreate(savedInstanceState);
        } finally {
            initializingBridge = false;
        }
        PlannerWidgetStorage.storePendingRouteFromIntent(this, getIntent());
        try {
            PlannerTaskNotificationScheduler.restore(this);
        } catch (RuntimeException exception) {
            android.util.Log.e("PlannerNotifications", "Could not restore notification actions.");
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        if (!initializingBridge) {
            PlannerCalendarEventStore.receive(this, intent);
        }
        PlannerWidgetStorage.storePendingRouteFromIntent(this, intent);
        super.onNewIntent(intent);
        setIntent(intent);
    }
}
