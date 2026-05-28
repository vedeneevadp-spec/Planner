package ru.chaotika.app;

final class WakeWordConfig {

    static final String HAOTIKA_PHRASE_ID = "haotika";
    static final String HAOTIKA_DISPLAY_PHRASE = "Хаотика";
    static final String HAOTIKA_LANGUAGE = "ru-RU";
    static final String HAOTIKA_MANIFEST_PATH = "wakewords/haotika_manifest.json";
    static final String HAOTIKA_MODEL_PATH = "wakewords/haotika.tflite";
    static final float HAOTIKA_THRESHOLD = 0.65f;
    static final int HAOTIKA_SAMPLE_RATE = 16_000;
    static final boolean HAOTIKA_VAD_ENABLED = true;

    final String phraseId;
    final String displayPhrase;
    final String language;
    final String manifestPath;
    final String modelPath;
    final float threshold;
    final int sampleRate;
    final boolean vadEnabled;

    private WakeWordConfig(
        String phraseId,
        String displayPhrase,
        String language,
        String manifestPath,
        String modelPath,
        float threshold,
        int sampleRate,
        boolean vadEnabled
    ) {
        this.phraseId = phraseId;
        this.displayPhrase = displayPhrase;
        this.language = language;
        this.manifestPath = manifestPath;
        this.modelPath = modelPath;
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
            HAOTIKA_MODEL_PATH,
            HAOTIKA_THRESHOLD,
            HAOTIKA_SAMPLE_RATE,
            HAOTIKA_VAD_ENABLED
        );
    }
}
