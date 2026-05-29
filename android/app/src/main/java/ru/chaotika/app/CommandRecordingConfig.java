package ru.chaotika.app;

final class CommandRecordingConfig {

    static final int BITS_PER_SAMPLE = 16;
    static final int CHANNEL_COUNT = 1;
    static final String BYTE_ORDER = "little_endian";
    static final String ENCODING = "pcm_s16le";
    static final int DEFAULT_MAX_DURATION_MS = 8000;
    static final int DEFAULT_MIN_DURATION_MS = 500;
    static final int DEFAULT_PRE_ROLL_MS = 200;
    static final int DEFAULT_SAMPLE_RATE_HERTZ = 16000;
    static final int DEFAULT_SILENCE_TIMEOUT_MS = 900;

    final int maxDurationMs;
    final int minDurationMs;
    final int preRollMs;
    final int sampleRateHertz;
    final int silenceTimeoutMs;
    final boolean vadEnabled;

    CommandRecordingConfig(
        int sampleRateHertz,
        int maxDurationMs,
        int minDurationMs,
        int silenceTimeoutMs,
        int preRollMs,
        boolean vadEnabled
    ) {
        this.sampleRateHertz = sampleRateHertz;
        this.maxDurationMs = maxDurationMs;
        this.minDurationMs = minDurationMs;
        this.silenceTimeoutMs = silenceTimeoutMs;
        this.preRollMs = preRollMs;
        this.vadEnabled = vadEnabled;
    }

    static CommandRecordingConfig defaultConfig() {
        return new CommandRecordingConfig(
            DEFAULT_SAMPLE_RATE_HERTZ,
            DEFAULT_MAX_DURATION_MS,
            DEFAULT_MIN_DURATION_MS,
            DEFAULT_SILENCE_TIMEOUT_MS,
            DEFAULT_PRE_ROLL_MS,
            true
        );
    }
}
