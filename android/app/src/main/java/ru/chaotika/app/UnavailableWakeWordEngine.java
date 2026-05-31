package ru.chaotika.app;

final class UnavailableWakeWordEngine implements WakeWordEngine {

    private final WakeWordConfig config;
    private final WakeWordError error;
    private final WakeWordMetricsLogger metricsLogger;

    UnavailableWakeWordEngine(WakeWordConfig config, WakeWordMetricsLogger metricsLogger, WakeWordError error) {
        this.config = config;
        this.metricsLogger = metricsLogger;
        this.error = error;
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
        return false;
    }

    @Override
    public void start(WakeWordListener listener) {
        WakeWordDiagnostics.recordError(error);
        metricsLogger.error(error);

        if (listener != null) {
            listener.onError(error);
        }
    }

    @Override
    public void stop() {}
}
