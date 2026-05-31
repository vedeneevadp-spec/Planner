package ru.chaotika.app;

import android.content.Context;
import android.content.pm.ApplicationInfo;

final class WakeWordEngineFactory {

    private WakeWordEngineFactory() {}

    static WakeWordEngine create(Context context, WakeWordMetricsLogger metricsLogger) {
        WakeWordConfig baseConfig = WakeWordConfig.haotika();
        AndroidWakeWordAssetSource assets = new AndroidWakeWordAssetSource(context);

        try {
            WakeWordModelManifest manifest = WakeWordModelManifest.read(assets, baseConfig);
            return create(context, manifest, baseConfig, assets, metricsLogger);
        } catch (WakeWordError error) {
            return new UnavailableWakeWordEngine(baseConfig, metricsLogger, error);
        }
    }

    static WakeWordEngine create(
        Context context,
        WakeWordConfig config,
        WakeWordAssetSource assets,
        WakeWordMetricsLogger metricsLogger
    ) {
        if (config.provider == WakeWordProvider.CUSTOM_ONNX) {
            try {
                WakeWordModelManifest manifest = WakeWordModelManifest.read(assets, config);
                return create(context, manifest, config, assets, metricsLogger);
            } catch (WakeWordError error) {
                return new UnavailableWakeWordEngine(config, metricsLogger, error);
            }
        }

        return switch (config.provider) {
            case MOCK -> new MockWakeWordEngine(config, metricsLogger);
            case CUSTOM_TFLITE -> new CustomTfliteWakeWordEngine(context, config, assets, metricsLogger);
            case CUSTOM_ONNX -> new CustomOnnxWakeWordEngine(context, config, assets, metricsLogger);
        };
    }

    private static WakeWordEngine create(
        Context context,
        WakeWordModelManifest manifest,
        WakeWordConfig baseConfig,
        WakeWordAssetSource assets,
        WakeWordMetricsLogger metricsLogger
    ) {
        WakeWordConfig manifestConfig = manifest.toConfig(baseConfig);

        if (manifest.provider != WakeWordProvider.CUSTOM_ONNX) {
            return create(context, manifestConfig, assets, metricsLogger);
        }

        if (
            manifest.inputKind == WakeWordModelInputKind.RAW_PCM &&
            manifest.frontend == WakeWordModelFrontend.NONE
        ) {
            return new CustomOnnxWakeWordEngine(context, manifestConfig, assets, metricsLogger);
        }

        if (
            manifest.inputKind == WakeWordModelInputKind.EMBEDDING_MATRIX &&
            manifest.frontend == WakeWordModelFrontend.LIVEKIT_OPENWAKEWORD
        ) {
            return new LiveKitOnnxWakeWordEngine(context, manifestConfig, assets, metricsLogger);
        }

        return new UnavailableWakeWordEngine(
            manifestConfig,
            metricsLogger,
            WakeWordError.unsupportedModelInput(
                "Unsupported ONNX wake-word input contract: inputKind=" +
                manifest.inputKind.manifestValue +
                ", frontend=" +
                manifest.frontend.manifestValue +
                "."
            )
        );
    }

    static boolean isDebuggable(Context context) {
        return (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }
}
