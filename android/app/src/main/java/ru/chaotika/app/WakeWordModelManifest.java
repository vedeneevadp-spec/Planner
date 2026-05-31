package ru.chaotika.app;

import java.nio.charset.StandardCharsets;
import org.json.JSONException;
import org.json.JSONObject;

final class WakeWordModelManifest {

    final String modelVersion;
    final String modelPath;
    final String classifierModelPath;
    final String embeddingModelPath;
    final WakeWordModelFrontend frontend;
    final FrontendConfig frontendConfig;
    final WakeWordModelInputKind inputKind;
    final boolean ioContractConfirmedForAndroid;
    final String melSpectrogramModelPath;
    final WakeWordProvider provider;
    final RuntimeConfig runtimeConfig;
    final float threshold;

    private WakeWordModelManifest(
        String modelVersion,
        String modelPath,
        String melSpectrogramModelPath,
        String embeddingModelPath,
        String classifierModelPath,
        WakeWordModelInputKind inputKind,
        WakeWordModelFrontend frontend,
        FrontendConfig frontendConfig,
        boolean ioContractConfirmedForAndroid,
        WakeWordProvider provider,
        RuntimeConfig runtimeConfig,
        float threshold
    ) {
        this.modelVersion = modelVersion;
        this.modelPath = modelPath;
        this.melSpectrogramModelPath = melSpectrogramModelPath;
        this.embeddingModelPath = embeddingModelPath;
        this.classifierModelPath = classifierModelPath;
        this.inputKind = inputKind;
        this.frontend = frontend;
        this.frontendConfig = frontendConfig;
        this.ioContractConfirmedForAndroid = ioContractConfirmedForAndroid;
        this.provider = provider;
        this.runtimeConfig = runtimeConfig;
        this.threshold = threshold;
    }

    static WakeWordModelManifest read(WakeWordAssetSource assets, WakeWordConfig config) throws WakeWordError {
        try {
            if (!assets.exists(config.manifestPath)) {
                throw WakeWordError.invalidModelManifest(
                    "Wake-word manifest is missing: " + config.manifestPath,
                    null
                );
            }

            JSONObject value = new JSONObject(new String(assets.read(config.manifestPath), StandardCharsets.UTF_8));

            requireString(value, "phraseId", config.phraseId);
            requireString(value, "displayPhrase", config.displayPhrase);
            requireString(value, "language", config.language);
            String modelVersion = readRequiredString(value, "modelVersion");
            WakeWordProvider provider = WakeWordProvider.fromManifestValue(readRequiredString(value, "provider"));
            String modelPath = readRequiredString(value, "modelPath");
            float threshold = readThreshold(value);
            requireInt(value, "sampleRate", config.sampleRate);
            requireBoolean(value, "vadEnabled", config.vadEnabled);
            WakeWordModelInputKind inputKind = WakeWordModelInputKind.fromManifestValue(
                value.optString("inputKind", WakeWordModelInputKind.RAW_PCM.manifestValue)
            );
            WakeWordModelFrontend frontend = WakeWordModelFrontend.fromManifestValue(
                value.optString("frontend", WakeWordModelFrontend.NONE.manifestValue)
            );
            ModelPaths modelPaths = ModelPaths.fromJson(value.optJSONObject("models"), modelPath);

            return new WakeWordModelManifest(
                modelVersion,
                modelPath,
                modelPaths.melSpectrogramModelPath,
                modelPaths.embeddingModelPath,
                modelPaths.classifierModelPath,
                inputKind,
                frontend,
                FrontendConfig.fromJson(value.optJSONObject("frontendConfig")),
                value.optBoolean("ioContractConfirmedForAndroid", false),
                provider,
                RuntimeConfig.fromJson(value.optJSONObject("runtime")),
                threshold
            );
        } catch (WakeWordError error) {
            throw error;
        } catch (Exception error) {
            throw WakeWordError.invalidModelManifest("Wake-word manifest is invalid.", error);
        }
    }

    WakeWordConfig toConfig(WakeWordConfig config) {
        return config.withManifest(this);
    }

    private static void requireString(JSONObject value, String key, String expected) throws WakeWordError, JSONException {
        String actual = value.getString(key);

        if (!expected.equals(actual)) {
            throw WakeWordError.invalidModelManifest(
                "Wake-word manifest " + key + " must be " + expected + ", got " + actual + ".",
                null
            );
        }
    }

    private static String readRequiredString(JSONObject value, String key) throws WakeWordError, JSONException {
        String actual = value.getString(key);

        if (actual.trim().isEmpty()) {
            throw WakeWordError.invalidModelManifest("Wake-word manifest " + key + " must be non-empty.", null);
        }

        return actual;
    }

    private static float readThreshold(JSONObject value) throws WakeWordError, JSONException {
        String key = "threshold";
        double actual = value.getDouble(key);

        if (!Double.isFinite(actual) || actual < 0d || actual > 1d) {
            throw WakeWordError.invalidModelManifest(
                "Wake-word manifest " + key + " must be between 0 and 1, got " + actual + ".",
                null
            );
        }

        return (float) actual;
    }

    private static void requireInt(JSONObject value, String key, int expected) throws WakeWordError, JSONException {
        int actual = value.getInt(key);

        if (expected != actual) {
            throw WakeWordError.invalidModelManifest(
                "Wake-word manifest " + key + " must be " + expected + ", got " + actual + ".",
                null
            );
        }
    }

    private static void requireBoolean(JSONObject value, String key, boolean expected) throws WakeWordError, JSONException {
        boolean actual = value.getBoolean(key);

        if (expected != actual) {
            throw WakeWordError.invalidModelManifest(
                "Wake-word manifest " + key + " must be " + expected + ", got " + actual + ".",
                null
            );
        }
    }

    static final class RuntimeConfig {

        static final int DEFAULT_FRAME_MS = 80;
        static final int DEFAULT_WINDOW_MS = 1_280;

        final int frameMs;
        final boolean scoreSmoothing;
        final int windowMs;

        private RuntimeConfig(int frameMs, int windowMs, boolean scoreSmoothing) {
            this.frameMs = frameMs;
            this.windowMs = windowMs;
            this.scoreSmoothing = scoreSmoothing;
        }

        static RuntimeConfig fromJson(JSONObject value) {
            if (value == null) {
                return defaults();
            }

            return new RuntimeConfig(
                value.optInt("frameMs", DEFAULT_FRAME_MS),
                value.optInt("windowMs", DEFAULT_WINDOW_MS),
                value.optBoolean("scoreSmoothing", true)
            );
        }

        static RuntimeConfig defaults() {
            return new RuntimeConfig(DEFAULT_FRAME_MS, DEFAULT_WINDOW_MS, true);
        }
    }

    static final class FrontendConfig {

        static final int DEFAULT_EMBEDDING_SIZE = 96;
        static final int DEFAULT_EMBEDDING_WINDOW_SIZE = 16;

        final int embeddingSize;
        final int embeddingWindowSize;

        private FrontendConfig(int embeddingWindowSize, int embeddingSize) {
            this.embeddingWindowSize = embeddingWindowSize;
            this.embeddingSize = embeddingSize;
        }

        static FrontendConfig fromJson(JSONObject value) throws WakeWordError {
            if (value == null) {
                return defaults();
            }

            int embeddingWindowSize = value.optInt("embeddingWindowSize", DEFAULT_EMBEDDING_WINDOW_SIZE);
            int embeddingSize = value.optInt("embeddingSize", DEFAULT_EMBEDDING_SIZE);

            if (embeddingWindowSize <= 0 || embeddingSize <= 0) {
                throw WakeWordError.invalidModelManifest("Wake-word frontendConfig dimensions must be positive.", null);
            }

            return new FrontendConfig(embeddingWindowSize, embeddingSize);
        }

        static FrontendConfig defaults() {
            return new FrontendConfig(DEFAULT_EMBEDDING_WINDOW_SIZE, DEFAULT_EMBEDDING_SIZE);
        }
    }

    private static final class ModelPaths {

        final String classifierModelPath;
        final String embeddingModelPath;
        final String melSpectrogramModelPath;

        private ModelPaths(String melSpectrogramModelPath, String embeddingModelPath, String classifierModelPath) {
            this.melSpectrogramModelPath = melSpectrogramModelPath;
            this.embeddingModelPath = embeddingModelPath;
            this.classifierModelPath = classifierModelPath;
        }

        static ModelPaths fromJson(JSONObject value, String fallbackClassifierModelPath) throws WakeWordError {
            if (value == null) {
                return new ModelPaths(
                    WakeWordConfig.HAOTIKA_LIVEKIT_MELSPECTROGRAM_MODEL_PATH,
                    WakeWordConfig.HAOTIKA_LIVEKIT_EMBEDDING_MODEL_PATH,
                    fallbackClassifierModelPath
                );
            }

            return new ModelPaths(
                readOptionalModelPath(value, "melspectrogram", WakeWordConfig.HAOTIKA_LIVEKIT_MELSPECTROGRAM_MODEL_PATH),
                readOptionalModelPath(value, "embedding", WakeWordConfig.HAOTIKA_LIVEKIT_EMBEDDING_MODEL_PATH),
                readOptionalModelPath(value, "classifier", fallbackClassifierModelPath)
            );
        }

        private static String readOptionalModelPath(JSONObject value, String key, String fallback) throws WakeWordError {
            String actual = value.optString(key, fallback).trim();
            if (actual.isEmpty()) {
                throw WakeWordError.invalidModelManifest("Wake-word models." + key + " must be non-empty.", null);
            }

            return actual;
        }
    }
}
