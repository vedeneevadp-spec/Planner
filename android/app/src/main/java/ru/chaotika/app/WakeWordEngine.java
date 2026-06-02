package ru.chaotika.app;

interface WakeWordEngine {
    String getWakePhrase();

    WakeWordConfig getConfig();

    boolean isRunning();

    CommandAudioPreBuffer latestCommandPreBuffer(int durationMs);

    void start(WakeWordListener listener);

    void stop();
}
