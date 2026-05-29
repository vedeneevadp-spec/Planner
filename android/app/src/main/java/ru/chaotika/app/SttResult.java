package ru.chaotika.app;

final class SttResult {

    final double confidence;
    final int durationMs;
    final String plannerIntentJson;
    final SttProvider provider;
    final SttSource source;
    final String transcript;

    SttResult(
        String transcript,
        double confidence,
        SttProvider provider,
        SttSource source,
        int durationMs,
        String plannerIntentJson
    ) {
        this.transcript = transcript;
        this.confidence = confidence;
        this.provider = provider;
        this.source = source;
        this.durationMs = durationMs;
        this.plannerIntentJson = plannerIntentJson;
    }
}
