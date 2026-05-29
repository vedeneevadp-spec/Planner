package ru.chaotika.app;

final class SttRequest {

    final boolean explicitUserAction;
    final CommandRecordingConfig recordingConfig;
    final SttSource source;
    final boolean wakeWordDetected;

    SttRequest(
        CommandRecordingConfig recordingConfig,
        SttSource source,
        boolean wakeWordDetected,
        boolean explicitUserAction
    ) {
        this.recordingConfig = recordingConfig;
        this.source = source;
        this.wakeWordDetected = wakeWordDetected;
        this.explicitUserAction = explicitUserAction;
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
}
