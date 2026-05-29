package ru.chaotika.app;

final class SttRequest {

    final CommandRecordingConfig recordingConfig;
    final SttSource source;

    SttRequest(CommandRecordingConfig recordingConfig, SttSource source) {
        this.recordingConfig = recordingConfig;
        this.source = source;
    }

    static SttRequest afterWakeWord() {
        return new SttRequest(CommandRecordingConfig.defaultConfig(), SttSource.ANDROID_SHORT_CLIP);
    }

    static SttRequest pushToTalk() {
        return new SttRequest(CommandRecordingConfig.defaultConfig(), SttSource.ANDROID_PUSH_TO_TALK);
    }
}
