package ru.chaotika.app;

import android.content.Context;
import android.content.pm.ApplicationInfo;

final class WakeWordEngineFactory {

    private WakeWordEngineFactory() {}

    static WakeWordEngine create(Context context, WakeWordMetricsLogger metricsLogger) {
        WakeWordConfig config = WakeWordConfig.haotika();
        AndroidWakeWordAssetSource assets = new AndroidWakeWordAssetSource(context);

        if (isDebuggable(context) && !assets.exists(config.modelPath)) {
            return new MockWakeWordEngine(config, metricsLogger);
        }

        return new CustomTfliteWakeWordEngine(context, config, assets, metricsLogger);
    }

    static boolean isDebuggable(Context context) {
        return (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }
}
