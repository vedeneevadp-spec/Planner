package ru.chaotika.app;

final class WakeWordDiagnostics {

    private static final Object LOCK = new Object();
    private static final WakeWordConfig CONFIG = WakeWordConfig.haotika();

    private static String modelVersion = "unknown";
    private static WakeWordProvider provider = CONFIG.provider;
    private static float threshold = CONFIG.threshold;
    private static float currentScore;
    private static float lastDetectionScore;
    private static int detectionCount;
    private static String lastMetric = "";
    private static String lastError = "";

    private WakeWordDiagnostics() {}

    static WakeWordDiagnosticsSnapshot snapshot() {
        synchronized (LOCK) {
            return new WakeWordDiagnosticsSnapshot(
                CONFIG.displayPhrase,
                modelVersion,
                provider,
                threshold,
                currentScore,
                lastDetectionScore,
                detectionCount,
                lastMetric,
                lastError
            );
        }
    }

    static void updateModelVersion(String nextModelVersion) {
        updateModel(nextModelVersion, threshold);
    }

    static void updateModel(String nextModelVersion, float nextThreshold) {
        updateModel(nextModelVersion, provider, nextThreshold);
    }

    static void updateModel(String nextModelVersion, WakeWordProvider nextProvider, float nextThreshold) {
        synchronized (LOCK) {
            modelVersion = nextModelVersion == null || nextModelVersion.trim().isEmpty() ? "unknown" : nextModelVersion;
            provider = nextProvider == null ? CONFIG.provider : nextProvider;
            threshold = nextThreshold;
        }
    }

    static void updateCurrentScore(float score) {
        synchronized (LOCK) {
            currentScore = score;
        }
    }

    static void recordDetection(WakeWordDetection detection) {
        synchronized (LOCK) {
            currentScore = detection.score;
            lastDetectionScore = detection.score;
            detectionCount += 1;
            lastMetric = WakeWordMetricsLogger.WAKE_DETECTED;
        }
    }

    static void recordMetric(String event) {
        synchronized (LOCK) {
            lastMetric = event;
        }
    }

    static void recordError(WakeWordError error) {
        synchronized (LOCK) {
            lastError = error.code.value;
            lastMetric = error.code.value;
        }
    }
}

final class WakeWordDiagnosticsSnapshot {

    final String phrase;
    final String modelVersion;
    final WakeWordProvider provider;
    final float threshold;
    final float currentScore;
    final float lastDetectionScore;
    final int detectionCount;
    final String lastMetric;
    final String lastError;

    WakeWordDiagnosticsSnapshot(
        String phrase,
        String modelVersion,
        WakeWordProvider provider,
        float threshold,
        float currentScore,
        float lastDetectionScore,
        int detectionCount,
        String lastMetric,
        String lastError
    ) {
        this.phrase = phrase;
        this.modelVersion = modelVersion;
        this.provider = provider;
        this.threshold = threshold;
        this.currentScore = currentScore;
        this.lastDetectionScore = lastDetectionScore;
        this.detectionCount = detectionCount;
        this.lastMetric = lastMetric;
        this.lastError = lastError;
    }
}
