package ru.chaotika.app;

final class SttRequest {

    final boolean explicitUserAction;
    final int audioCueDurationMs;
    final long captureRequestedAtElapsedMs;
    final long cueCompletedAtElapsedMs;
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
        long cueCompletedAtElapsedMs,
        int audioCueDurationMs
    ) {
        this.recordingConfig = recordingConfig;
        this.source = source;
        this.wakeWordDetected = wakeWordDetected;
        this.explicitUserAction = explicitUserAction;
        this.captureRequestedAtElapsedMs = captureRequestedAtElapsedMs;
        this.cueCompletedAtElapsedMs = cueCompletedAtElapsedMs;
        this.audioCueDurationMs = audioCueDurationMs;
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

    SttRequest withRuntimeTiming(
        long captureRequestedAtElapsedMs,
        long cueCompletedAtElapsedMs,
        int audioCueDurationMs
    ) {
        return new SttRequest(
            recordingConfig,
            source,
            wakeWordDetected,
            explicitUserAction,
            captureRequestedAtElapsedMs,
            cueCompletedAtElapsedMs,
            audioCueDurationMs
        );
    }
}
