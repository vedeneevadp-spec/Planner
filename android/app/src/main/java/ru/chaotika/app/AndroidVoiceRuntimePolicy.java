package ru.chaotika.app;

final class AndroidVoiceRuntimePolicy {

    private AndroidVoiceRuntimePolicy() {}

    static Degradation missingWakeModel() {
        return new Degradation(
            AndroidVoiceRuntimeStatus.BLOCKED,
            AndroidVoiceRuntimeError.MISSING_WAKE_MODEL,
            false,
            false,
            true,
            false,
            true
        );
    }

    static Degradation microphonePermissionRevoked() {
        return new Degradation(
            AndroidVoiceRuntimeStatus.BLOCKED,
            AndroidVoiceRuntimeError.MISSING_MICROPHONE_PERMISSION,
            false,
            false,
            false,
            true,
            true
        );
    }

    static Degradation notificationPermissionRevoked(boolean wakeWordEnabled) {
        return new Degradation(
            AndroidVoiceRuntimeStatus.BLOCKED,
            AndroidVoiceRuntimeError.MISSING_NOTIFICATION_PERMISSION,
            wakeWordEnabled,
            false,
            true,
            false,
            true
        );
    }

    static Degradation serviceStartFailure(Throwable error) {
        return new Degradation(
            AndroidVoiceRuntimeStatus.BLOCKED,
            AndroidVoiceRuntimeError.fromServiceStartFailure(error),
            true,
            false,
            true,
            false,
            true
        );
    }

    static Degradation serviceKilledOrStopped(boolean microphonePermissionGranted) {
        return new Degradation(
            AndroidVoiceRuntimeStatus.STOPPED,
            null,
            true,
            false,
            microphonePermissionGranted,
            !microphonePermissionGranted,
            true
        );
    }

    static boolean isPushToTalkAvailable(boolean microphonePermissionGranted) {
        return microphonePermissionGranted;
    }

    static final class Degradation {

        final boolean backgroundWakeWordEnabled;
        final AndroidVoiceRuntimeError error;
        final boolean manualTextInputAvailable;
        final boolean pushToTalkAvailable;
        final boolean recorderBlocked;
        final AndroidVoiceRuntimeStatus status;
        final boolean wakeWordEnabled;

        Degradation(
            AndroidVoiceRuntimeStatus status,
            AndroidVoiceRuntimeError error,
            boolean wakeWordEnabled,
            boolean backgroundWakeWordEnabled,
            boolean pushToTalkAvailable,
            boolean recorderBlocked,
            boolean manualTextInputAvailable
        ) {
            this.status = status;
            this.error = error;
            this.wakeWordEnabled = wakeWordEnabled;
            this.backgroundWakeWordEnabled = backgroundWakeWordEnabled;
            this.pushToTalkAvailable = pushToTalkAvailable;
            this.recorderBlocked = recorderBlocked;
            this.manualTextInputAvailable = manualTextInputAvailable;
        }
    }
}
