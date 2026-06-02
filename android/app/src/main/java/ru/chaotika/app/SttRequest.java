package ru.chaotika.app;

final class SttRequest {

    final boolean explicitUserAction;
    final int audioSignalDurationMs;
    final long audioSignalCompletedAtElapsedMs;
    final boolean audioSignalPlayed;
    final long audioSignalStartedAtElapsedMs;
    final long captureRequestedAtElapsedMs;
    final CommandAudioPreBuffer preBuffer;
    final CommandRecordingConfig recordingConfig;
    final SttSource source;
    final boolean wakeWordDetected;

    SttRequest(
        CommandRecordingConfig recordingConfig,
        SttSource source,
        boolean wakeWordDetected,
        boolean explicitUserAction
    ) {
        this(
            recordingConfig,
            source,
            wakeWordDetected,
            explicitUserAction,
            0L,
            0L,
            0L,
            0,
            false,
            CommandAudioPreBuffer.empty(recordingConfig.sampleRateHertz)
        );
    }

    private SttRequest(
        CommandRecordingConfig recordingConfig,
        SttSource source,
        boolean wakeWordDetected,
        boolean explicitUserAction,
        long captureRequestedAtElapsedMs,
        long audioSignalStartedAtElapsedMs,
        long audioSignalCompletedAtElapsedMs,
        int audioSignalDurationMs,
        boolean audioSignalPlayed,
        CommandAudioPreBuffer preBuffer
    ) {
        this.recordingConfig = recordingConfig;
        this.source = source;
        this.wakeWordDetected = wakeWordDetected;
        this.explicitUserAction = explicitUserAction;
        this.captureRequestedAtElapsedMs = captureRequestedAtElapsedMs;
        this.audioSignalStartedAtElapsedMs = audioSignalStartedAtElapsedMs;
        this.audioSignalCompletedAtElapsedMs = audioSignalCompletedAtElapsedMs;
        this.audioSignalDurationMs = audioSignalDurationMs;
        this.audioSignalPlayed = audioSignalPlayed;
        this.preBuffer = preBuffer == null ? CommandAudioPreBuffer.empty(recordingConfig.sampleRateHertz) : preBuffer;
    }

    static SttRequest afterWakeWord() {
        return afterWakeWord(CommandAudioPreBuffer.empty(CommandRecordingConfig.DEFAULT_SAMPLE_RATE_HERTZ));
    }

    static SttRequest afterWakeWord(CommandAudioPreBuffer preBuffer) {
        return new SttRequest(
            CommandRecordingConfig.defaultConfig(),
            SttSource.ANDROID_SHORT_CLIP,
            true,
            false
        ).withPreBuffer(preBuffer);
    }

    static SttRequest pushToTalk() {
        return new SttRequest(
            CommandRecordingConfig.defaultConfig(),
            SttSource.ANDROID_PUSH_TO_TALK,
            false,
            true
        );
    }

    SttRequest withAudioSignalTiming(
        long captureRequestedAtElapsedMs,
        long audioSignalStartedAtElapsedMs,
        long audioSignalCompletedAtElapsedMs,
        int audioSignalDurationMs,
        boolean audioSignalPlayed
    ) {
        return new SttRequest(
            recordingConfig,
            source,
            wakeWordDetected,
            explicitUserAction,
            captureRequestedAtElapsedMs,
            audioSignalStartedAtElapsedMs,
            audioSignalCompletedAtElapsedMs,
            audioSignalDurationMs,
            audioSignalPlayed,
            preBuffer
        );
    }

    SttRequest withPreBuffer(CommandAudioPreBuffer preBuffer) {
        return new SttRequest(
            recordingConfig,
            source,
            wakeWordDetected,
            explicitUserAction,
            captureRequestedAtElapsedMs,
            audioSignalStartedAtElapsedMs,
            audioSignalCompletedAtElapsedMs,
            audioSignalDurationMs,
            audioSignalPlayed,
            preBuffer
        );
    }
}
