package ru.chaotika.app;

import com.getcapacitor.BridgeActivity;

final class PlannerDistribution {
    private PlannerDistribution() {}

    static void registerPlugins(BridgeActivity activity) {
        activity.registerPlugin(PlannerAppUpdatesPlugin.class);
    }
}
