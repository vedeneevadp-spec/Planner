package ru.chaotika.app;

interface CommandRecordingObserver {
    void onRecorderStarted(long startedAtElapsedMs);
}
