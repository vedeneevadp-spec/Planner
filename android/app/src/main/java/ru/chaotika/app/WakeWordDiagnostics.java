package ru.chaotika.app;

final class WakeWordDiagnostics {

    private static final Object LOCK = new Object();
    private static final WakeWordConfig CONFIG = WakeWordConfig.haotika();

    private static String modelVersion = "unknown";
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
                CONFIG.threshold,
                currentScore,
                lastDetectionScore,
                detectionCount,
                lastMetric,
                lastError
            );
        }
    }

    static void updateModelVersion(String nextModelVersion) {
        synchronized (LOCK) {
            modelVersion = nextModelVersion == null || nextModelVersion.trim().isEmpty() ? "unknown" : nextModelVersion;
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
    final float threshold;
    final float currentScore;
    final float lastDetectionScore;
    final int detectionCount;
    final String lastMetric;
    final String lastError;

    WakeWordDiagnosticsSnapshot(
        String phrase,
        String modelVersion,
        float threshold,
        float currentScore,
        float lastDetectionScore,
        int detectionCount,
        String lastMetric,
        String lastError
    ) {
        this.phrase = phrase;
        this.modelVersion = modelVersion;
        this.threshold = threshold;
        this.currentScore = currentScore;
        this.lastDetectionScore = lastDetectionScore;
        this.detectionCount = detectionCount;
        this.lastMetric = lastMetric;
        this.lastError = lastError;
    }
}
