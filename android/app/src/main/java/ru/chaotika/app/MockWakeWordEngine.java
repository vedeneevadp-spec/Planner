package ru.chaotika.app;

final class MockWakeWordEngine implements WakeWordEngine {

    private final WakeWordConfig config;
    private final WakeWordMetricsLogger metricsLogger;
    private WakeWordListener listener;
    private boolean isRunning;

    MockWakeWordEngine() {
        this(WakeWordConfig.haotika(), new WakeWordMetricsLogger());
    }

    MockWakeWordEngine(WakeWordConfig config, WakeWordMetricsLogger metricsLogger) {
        this.config = config;
        this.metricsLogger = metricsLogger;
    }

    @Override
    public String getWakePhrase() {
        return config.displayPhrase;
    }

    @Override
    public WakeWordConfig getConfig() {
        return config;
    }

    @Override
    public boolean isRunning() {
        return isRunning;
    }

    @Override
    public CommandAudioPreBuffer latestCommandPreBuffer(int durationMs) {
        return CommandAudioPreBuffer.empty(config.sampleRate);
    }

    @Override
    public void start(WakeWordListener listener) {
        this.listener = listener;
        isRunning = true;
        // TODO: Replace with an on-device wake-word SDK implementation.
        // The real provider must process microphone frames locally and must not
        // send audio to the server before the wake word is detected.
    }

    @Override
    public void stop() {
        isRunning = false;
        listener = null;
    }

    void simulateWakeWord() {
        if (isRunning && listener != null) {
            isRunning = false;
            WakeWordDetection detection = new WakeWordDetection(
                config.phraseId,
                config.displayPhrase,
                1f,
                System.currentTimeMillis()
            );
            WakeWordDiagnostics.recordDetection(detection);
            metricsLogger.wakeDetected(detection);
            listener.onWakeWordDetected(detection);
        }
    }
}
