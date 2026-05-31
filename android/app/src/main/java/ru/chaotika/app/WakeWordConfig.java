package ru.chaotika.app;

final class WakeWordConfig {

    static final String HAOTIKA_PHRASE_ID = "haotika";
    static final String HAOTIKA_DISPLAY_PHRASE = "Хаотика";
    static final String HAOTIKA_LANGUAGE = "ru-RU";
    static final String HAOTIKA_MANIFEST_PATH = "wakewords/haotika_manifest.json";
    static final String HAOTIKA_ONNX_MODEL_PATH = "wakewords/haotika.onnx";
    static final String HAOTIKA_TFLITE_MODEL_PATH = "wakewords/haotika.tflite";
    static final String HAOTIKA_LIVEKIT_MELSPECTROGRAM_MODEL_PATH = "wakewords/livekit/melspectrogram.onnx";
    static final String HAOTIKA_LIVEKIT_EMBEDDING_MODEL_PATH = "wakewords/livekit/embedding_model.onnx";
    static final float HAOTIKA_THRESHOLD = 0.65f;
    static final int HAOTIKA_SAMPLE_RATE = 16_000;
    static final boolean HAOTIKA_VAD_ENABLED = true;
    static final WakeWordProvider HAOTIKA_PROVIDER = WakeWordProvider.CUSTOM_ONNX;

    final String classifierModelPath;
    final String phraseId;
    final String displayPhrase;
    final WakeWordModelFrontend frontend;
    final String embeddingModelPath;
    final int embeddingSize;
    final int embeddingWindowSize;
    final boolean ioContractConfirmedForAndroid;
    final WakeWordModelInputKind inputKind;
    final String language;
    final String manifestPath;
    final String melSpectrogramModelPath;
    final String modelPath;
    final WakeWordProvider provider;
    final float threshold;
    final int sampleRate;
    final boolean vadEnabled;

    WakeWordConfig(
        String phraseId,
        String displayPhrase,
        String language,
        String manifestPath,
        String modelPath,
        String melSpectrogramModelPath,
        String embeddingModelPath,
        String classifierModelPath,
        WakeWordModelInputKind inputKind,
        WakeWordModelFrontend frontend,
        boolean ioContractConfirmedForAndroid,
        int embeddingWindowSize,
        int embeddingSize,
        WakeWordProvider provider,
        float threshold,
        int sampleRate,
        boolean vadEnabled
    ) {
        this.phraseId = phraseId;
        this.displayPhrase = displayPhrase;
        this.language = language;
        this.manifestPath = manifestPath;
        this.modelPath = modelPath;
        this.melSpectrogramModelPath = melSpectrogramModelPath;
        this.embeddingModelPath = embeddingModelPath;
        this.classifierModelPath = classifierModelPath;
        this.inputKind = inputKind;
        this.frontend = frontend;
        this.ioContractConfirmedForAndroid = ioContractConfirmedForAndroid;
        this.embeddingWindowSize = embeddingWindowSize;
        this.embeddingSize = embeddingSize;
        this.provider = provider;
        this.threshold = threshold;
        this.sampleRate = sampleRate;
        this.vadEnabled = vadEnabled;
    }

    static WakeWordConfig haotika() {
        return new WakeWordConfig(
            HAOTIKA_PHRASE_ID,
            HAOTIKA_DISPLAY_PHRASE,
            HAOTIKA_LANGUAGE,
            HAOTIKA_MANIFEST_PATH,
            HAOTIKA_ONNX_MODEL_PATH,
            HAOTIKA_LIVEKIT_MELSPECTROGRAM_MODEL_PATH,
            HAOTIKA_LIVEKIT_EMBEDDING_MODEL_PATH,
            HAOTIKA_ONNX_MODEL_PATH,
            WakeWordModelInputKind.EMBEDDING_MATRIX,
            WakeWordModelFrontend.LIVEKIT_OPENWAKEWORD,
            false,
            16,
            96,
            HAOTIKA_PROVIDER,
            HAOTIKA_THRESHOLD,
            HAOTIKA_SAMPLE_RATE,
            HAOTIKA_VAD_ENABLED
        );
    }

    WakeWordConfig withManifest(WakeWordModelManifest manifest) {
        return new WakeWordConfig(
            phraseId,
            displayPhrase,
            language,
            manifestPath,
            manifest.modelPath,
            manifest.melSpectrogramModelPath,
            manifest.embeddingModelPath,
            manifest.classifierModelPath,
            manifest.inputKind,
            manifest.frontend,
            manifest.ioContractConfirmedForAndroid,
            manifest.frontendConfig.embeddingWindowSize,
            manifest.frontendConfig.embeddingSize,
            manifest.provider,
            manifest.threshold,
            sampleRate,
            vadEnabled
        );
    }

    static WakeWordConfig haotikaForProvider(WakeWordProvider provider) {
        return new WakeWordConfig(
            HAOTIKA_PHRASE_ID,
            HAOTIKA_DISPLAY_PHRASE,
            HAOTIKA_LANGUAGE,
            HAOTIKA_MANIFEST_PATH,
            provider == WakeWordProvider.CUSTOM_TFLITE ? HAOTIKA_TFLITE_MODEL_PATH : HAOTIKA_ONNX_MODEL_PATH,
            provider == WakeWordProvider.CUSTOM_ONNX
                ? HAOTIKA_LIVEKIT_MELSPECTROGRAM_MODEL_PATH
                : "",
            provider == WakeWordProvider.CUSTOM_ONNX
                ? HAOTIKA_LIVEKIT_EMBEDDING_MODEL_PATH
                : "",
            provider == WakeWordProvider.CUSTOM_TFLITE ? HAOTIKA_TFLITE_MODEL_PATH : HAOTIKA_ONNX_MODEL_PATH,
            provider == WakeWordProvider.CUSTOM_ONNX ? WakeWordModelInputKind.EMBEDDING_MATRIX : WakeWordModelInputKind.RAW_PCM,
            provider == WakeWordProvider.CUSTOM_ONNX ? WakeWordModelFrontend.LIVEKIT_OPENWAKEWORD : WakeWordModelFrontend.NONE,
            false,
            16,
            96,
            provider,
            provider == WakeWordProvider.CUSTOM_TFLITE ? 0.99f : HAOTIKA_THRESHOLD,
            HAOTIKA_SAMPLE_RATE,
            HAOTIKA_VAD_ENABLED
        );
    }
}
