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
        PlannerDistribution.registerPlugins(this);
        registerPlugin(PlannerCalendarEventsPlugin.class);
        registerPlugin(PlannerIncomingSharesPlugin.class);
        if (savedInstanceState == null) {
            captureIncomingDraft(getIntent());
        }
        // BridgeActivity.load() calls our onNewIntent with the launch intent again.
        // Capture it once above, and do not re-import it on activity recreation.
        initializingBridge = true;
        try {
            super.onCreate(savedInstanceState);
        } finally {
            initializingBridge = false;
        }
        captureWidgetRoute(getIntent());
        try {
            PlannerTaskNotificationScheduler.restore(this);
        } catch (RuntimeException exception) {
            android.util.Log.e("PlannerNotifications", "Could not restore notification actions.");
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        if (!initializingBridge) {
            captureIncomingDraft(intent);
        }
        captureWidgetRoute(intent);
        super.onNewIntent(intent);
        setIntent(intent);
    }

    private void captureIncomingDraft(Intent intent) {
        PlannerCalendarEventStore.receive(this, intent);
        PlannerIncomingShareStore.receive(this, intent);
    }

    private void captureWidgetRoute(Intent intent) {
        if (intent != null && !Intent.ACTION_SEND.equals(intent.getAction())) {
            PlannerWidgetStorage.storePendingRouteFromIntent(this, intent);
        }
    }
}
