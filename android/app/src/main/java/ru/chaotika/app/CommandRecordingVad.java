package ru.chaotika.app;

final class CommandRecordingVad {

    private static final int SPEECH_CANDIDATE_PEAK = 420;
    private static final double SPEECH_CANDIDATE_ACTIVE_RATIO = 0.02d;
    private static final double SPEECH_CANDIDATE_RMS = 0.0045d;

    private final CommandRecordingConfig config;
    private boolean hasSpeech;
    private long lastSpeechAtMs;

    CommandRecordingVad(CommandRecordingConfig config, long startedAtMs) {
        this.config = config;
        this.lastSpeechAtMs = startedAtMs;
    }

    void observe(Pcm16AudioActivity.Result activity, long frameReadAtMs) {
        if (!config.vadEnabled || isSpeechFrame(activity)) {
            hasSpeech = true;
            lastSpeechAtMs = frameReadAtMs;
        }
    }

    boolean shouldStop(long nowMs, int elapsedMs) {
        if (!config.vadEnabled) {
            return false;
        }

        if (!hasSpeech) {
            return elapsedMs >= config.initialSilenceTimeoutMs;
        }

        return nowMs - lastSpeechAtMs >= config.silenceTimeoutMs;
    }

    boolean hasSpeech() {
        return hasSpeech;
    }

    private static boolean isSpeechFrame(Pcm16AudioActivity.Result activity) {
        return activity.hasVoiceActivity ||
            (
                activity.peak >= SPEECH_CANDIDATE_PEAK &&
                activity.rms >= SPEECH_CANDIDATE_RMS &&
                activity.activeRatio >= SPEECH_CANDIDATE_ACTIVE_RATIO
            );
    }
}
