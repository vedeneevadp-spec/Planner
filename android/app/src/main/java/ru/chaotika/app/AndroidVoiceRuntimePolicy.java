package ru.chaotika.app;

final class AndroidVoiceRuntimePolicy {

    static final double BACKGROUND_CPU_HARD_LIMIT_PERCENT = 250d;
    static final int BACKGROUND_CPU_SUSTAINED_SAMPLE_COUNT = 3;
    static final double BACKGROUND_CPU_SUSTAINED_LIMIT_PERCENT = 125d;
    static final int BACKGROUND_LOW_BATTERY_PERCENT = 15;

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

    static Degradation batteryRestricted() {
        return new Degradation(
            AndroidVoiceRuntimeStatus.BLOCKED,
            AndroidVoiceRuntimeError.BATTERY_RESTRICTED,
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

    static boolean isCpuOverSustainedLimit(AndroidVoiceRuntimeSamples samples) {
        return samples.cpu.processCpuPercent >= BACKGROUND_CPU_SUSTAINED_LIMIT_PERCENT;
    }

    static boolean shouldStopBackgroundWakeWord(
        AndroidVoiceRuntimeSamples samples,
        int sustainedHighCpuSampleCount
    ) {
        if (!samples.battery.isCharging && samples.battery.isPowerSaveMode) {
            return true;
        }

        if (
            !samples.battery.isCharging &&
            samples.battery.levelPercent >= 0 &&
            samples.battery.levelPercent <= BACKGROUND_LOW_BATTERY_PERCENT
        ) {
            return true;
        }

        if (samples.cpu.processCpuPercent >= BACKGROUND_CPU_HARD_LIMIT_PERCENT) {
            return true;
        }

        return sustainedHighCpuSampleCount >= BACKGROUND_CPU_SUSTAINED_SAMPLE_COUNT &&
            isCpuOverSustainedLimit(samples);
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
