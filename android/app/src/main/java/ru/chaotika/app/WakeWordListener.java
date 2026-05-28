package ru.chaotika.app;

interface WakeWordListener {
    void onWakeWordDetected(WakeWordDetection detection);

    void onScore(float score);

    void onError(WakeWordError error);
}
