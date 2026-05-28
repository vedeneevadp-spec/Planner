package ru.chaotika.app;

interface WakeWordEngine {
    String getWakePhrase();

    WakeWordConfig getConfig();

    boolean isRunning();

    void start(WakeWordListener listener);

    void stop();
}
