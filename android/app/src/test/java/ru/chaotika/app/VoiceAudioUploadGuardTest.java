package ru.chaotika.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class VoiceAudioUploadGuardTest {

    @Test
    public void blocksWakeWordUploadBeforeDetection() {
        VoiceAudioUploadGuard.Decision decision = VoiceAudioUploadGuard.decide(
            input(VoiceAudioUploadGuard.Source.ANDROID_WAKE_WORD, false, false)
        );

        assertFalse(decision.allowed);
        assertEquals(VoiceAudioUploadGuard.Reason.WAKE_WORD_REQUIRED, decision.reason);
    }

    @Test
    public void allowsWakeWordUploadOnlyAfterDetectionAndValidation() {
        VoiceAudioUploadGuard.Decision decision = VoiceAudioUploadGuard.decide(
            input(VoiceAudioUploadGuard.Source.ANDROID_WAKE_WORD, true, false)
        );

        assertTrue(decision.allowed);
    }

    @Test
    public void blocksPushToTalkWithoutExplicitUserAction() {
        VoiceAudioUploadGuard.Decision decision = VoiceAudioUploadGuard.decide(
            input(VoiceAudioUploadGuard.Source.ANDROID_PUSH_TO_TALK, false, false)
        );

        assertFalse(decision.allowed);
        assertEquals(VoiceAudioUploadGuard.Reason.EXPLICIT_USER_ACTION_REQUIRED, decision.reason);
    }

    @Test
    public void blocksSilentTooShortAndTooQuietAudio() {
        assertEquals(
            VoiceAudioUploadGuard.Reason.TOO_SHORT,
            VoiceAudioUploadGuard.decide(
                new VoiceAudioUploadGuard.Input(
                    VoiceAudioUploadGuard.Source.ANDROID_PUSH_TO_TALK,
                    false,
                    true,
                    true,
                    200,
                    true,
                    false,
                    false
                )
            ).reason
        );
        assertEquals(
            VoiceAudioUploadGuard.Reason.SILENT_AUDIO,
            VoiceAudioUploadGuard.decide(
                new VoiceAudioUploadGuard.Input(
                    VoiceAudioUploadGuard.Source.ANDROID_PUSH_TO_TALK,
                    false,
                    true,
                    true,
                    900,
                    true,
                    true,
                    false
                )
            ).reason
        );
        assertEquals(
            VoiceAudioUploadGuard.Reason.TOO_QUIET,
            VoiceAudioUploadGuard.decide(
                new VoiceAudioUploadGuard.Input(
                    VoiceAudioUploadGuard.Source.ANDROID_PUSH_TO_TALK,
                    false,
                    true,
                    true,
                    900,
                    true,
                    false,
                    true
                )
            ).reason
        );
    }

    @Test
    public void blocksSignalOnlyAudioWhenLocalValidationDoesNotFindACommand() {
        VoiceAudioUploadGuard.Decision decision = VoiceAudioUploadGuard.decide(
            new VoiceAudioUploadGuard.Input(
                VoiceAudioUploadGuard.Source.ANDROID_WAKE_WORD,
                true,
                false,
                false,
                700,
                false,
                false,
                false
            )
        );

        assertFalse(decision.allowed);
        assertEquals(VoiceAudioUploadGuard.Reason.LOCAL_VALIDATION_FAILED, decision.reason);
    }

    private static VoiceAudioUploadGuard.Input input(
        VoiceAudioUploadGuard.Source source,
        boolean wakeWordDetected,
        boolean explicitUserAction
    ) {
        return new VoiceAudioUploadGuard.Input(
            source,
            wakeWordDetected,
            explicitUserAction,
            true,
            900,
            true,
            false,
            false
        );
    }
}
