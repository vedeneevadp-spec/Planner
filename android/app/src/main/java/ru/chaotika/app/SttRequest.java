package ru.chaotika.app;

final class SttRequest {

    final boolean explicitUserAction;
    final int audioSignalDurationMs;
    final long audioSignalCompletedAtElapsedMs;
    final long captureRequestedAtElapsedMs;
    final CommandRecordingConfig recordingConfig;
    final SttSource source;
    final boolean wakeWordDetected;

    SttRequest(
        CommandRecordingConfig recordingConfig,
        SttSource source,
        boolean wakeWordDetected,
        boolean explicitUserAction
    ) {
        this(recordingConfig, source, wakeWordDetected, explicitUserAction, 0L, 0L, 0);
    }

    private SttRequest(
        CommandRecordingConfig recordingConfig,
        SttSource source,
        boolean wakeWordDetected,
        boolean explicitUserAction,
        long captureRequestedAtElapsedMs,
        long audioSignalCompletedAtElapsedMs,
        int audioSignalDurationMs
    ) {
        this.recordingConfig = recordingConfig;
        this.source = source;
        this.wakeWordDetected = wakeWordDetected;
        this.explicitUserAction = explicitUserAction;
        this.captureRequestedAtElapsedMs = captureRequestedAtElapsedMs;
        this.audioSignalCompletedAtElapsedMs = audioSignalCompletedAtElapsedMs;
        this.audioSignalDurationMs = audioSignalDurationMs;
    }

    static SttRequest afterWakeWord() {
        return new SttRequest(
            CommandRecordingConfig.defaultConfig(),
            SttSource.ANDROID_SHORT_CLIP,
            true,
            false
        );
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
        long audioSignalCompletedAtElapsedMs,
        int audioSignalDurationMs
    ) {
        return new SttRequest(
            recordingConfig,
            source,
            wakeWordDetected,
            explicitUserAction,
            captureRequestedAtElapsedMs,
            audioSignalCompletedAtElapsedMs,
            audioSignalDurationMs
        );
    }
}
