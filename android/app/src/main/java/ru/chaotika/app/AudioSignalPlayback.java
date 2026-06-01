package ru.chaotika.app;

final class AudioSignalPlayback {

    final long completedAtElapsedMs;
    final int durationMs;
    final boolean failed;
    final boolean played;
    final long startedAtElapsedMs;

    AudioSignalPlayback(
        boolean played,
        boolean failed,
        int durationMs,
        long startedAtElapsedMs,
        long completedAtElapsedMs
    ) {
        this.played = played;
        this.failed = failed;
        this.durationMs = Math.max(0, durationMs);
        this.startedAtElapsedMs = Math.max(0L, startedAtElapsedMs);
        this.completedAtElapsedMs = Math.max(0L, completedAtElapsedMs);
    }
}

interface AudioSignalCallback {
    void onComplete(AudioSignalPlayback playback);
}
