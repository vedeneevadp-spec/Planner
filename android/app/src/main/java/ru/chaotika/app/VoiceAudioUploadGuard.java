package ru.chaotika.app;

final class VoiceAudioUploadGuard {

    private static final int MAX_DURATION_MS = CommandRecordingConfig.DEFAULT_MAX_DURATION_MS;
    private static final int MIN_DURATION_MS = CommandRecordingConfig.DEFAULT_MIN_DURATION_MS;

    private VoiceAudioUploadGuard() {}

    static Decision decide(Input input) {
        if (input.source == Source.ANDROID_WAKE_WORD && !input.wakeWordDetected) {
            return Decision.blocked(Reason.WAKE_WORD_REQUIRED);
        }

        if (
            (input.source == Source.ANDROID_PUSH_TO_TALK || input.source == Source.WEB_PUSH_TO_TALK) &&
            !input.explicitUserAction
        ) {
            return Decision.blocked(Reason.EXPLICIT_USER_ACTION_REQUIRED);
        }

        if (!input.localValidationPassed) {
            return Decision.blocked(Reason.LOCAL_VALIDATION_FAILED);
        }

        if (input.durationMs < MIN_DURATION_MS) {
            return Decision.blocked(Reason.TOO_SHORT);
        }

        if (input.durationMs > MAX_DURATION_MS) {
            return Decision.blocked(Reason.TOO_LONG);
        }

        if (input.isSilent) {
            return Decision.blocked(Reason.SILENT_AUDIO);
        }

        if (input.isTooQuiet) {
            return Decision.blocked(Reason.TOO_QUIET);
        }

        if (!input.hasVoiceActivity) {
            return Decision.blocked(Reason.NO_VOICE_ACTIVITY);
        }

        return Decision.allowed();
    }

    static Source sourceFromSttRequest(SttRequest request) {
        if (request.source == SttSource.ANDROID_PUSH_TO_TALK) {
            return Source.ANDROID_PUSH_TO_TALK;
        }

        return Source.ANDROID_WAKE_WORD;
    }

    enum Source {
        ANDROID_PUSH_TO_TALK,
        ANDROID_WAKE_WORD,
        WEB_PUSH_TO_TALK
    }

    enum Reason {
        EXPLICIT_USER_ACTION_REQUIRED,
        LOCAL_VALIDATION_FAILED,
        NO_VOICE_ACTIVITY,
        SILENT_AUDIO,
        TOO_LONG,
        TOO_QUIET,
        TOO_SHORT,
        WAKE_WORD_REQUIRED
    }

    static final class Input {
        final int durationMs;
        final boolean explicitUserAction;
        final boolean hasVoiceActivity;
        final boolean isSilent;
        final boolean isTooQuiet;
        final boolean localValidationPassed;
        final Source source;
        final boolean wakeWordDetected;

        Input(
            Source source,
            boolean wakeWordDetected,
            boolean explicitUserAction,
            boolean localValidationPassed,
            int durationMs,
            boolean hasVoiceActivity,
            boolean isSilent,
            boolean isTooQuiet
        ) {
            this.source = source;
            this.wakeWordDetected = wakeWordDetected;
            this.explicitUserAction = explicitUserAction;
            this.localValidationPassed = localValidationPassed;
            this.durationMs = durationMs;
            this.hasVoiceActivity = hasVoiceActivity;
            this.isSilent = isSilent;
            this.isTooQuiet = isTooQuiet;
        }
    }

    static final class Decision {
        final boolean allowed;
        final Reason reason;

        private Decision(boolean allowed, Reason reason) {
            this.allowed = allowed;
            this.reason = reason;
        }

        static Decision allowed() {
            return new Decision(true, null);
        }

        static Decision blocked(Reason reason) {
            return new Decision(false, reason);
        }
    }
}
