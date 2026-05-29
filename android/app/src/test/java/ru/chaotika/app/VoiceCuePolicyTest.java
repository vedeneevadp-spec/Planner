package ru.chaotika.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class VoiceCuePolicyTest {

    @Test
    public void playsDoneCueOnlyForSuccessfulAndroidMutatingActions() {
        assertTrue(VoiceCuePolicy.shouldPlayDoneCue("android_wake_word", "create_task", "success", false, true));
        assertTrue(VoiceCuePolicy.shouldPlayDoneCue("android_microphone", "add_shopping_item", "success", false, true));
        assertTrue(VoiceCuePolicy.shouldPlayDoneCue("android_microphone", "reschedule_task", "success", false, true));
    }

    @Test
    public void skipsDoneCueForPreviewErrorsClarifyUnlockAndWeb() {
        assertFalse(VoiceCuePolicy.shouldPlayDoneCue("android_wake_word", "create_task", "failed", false, true));
        assertFalse(VoiceCuePolicy.shouldPlayDoneCue("android_wake_word", "clarify", "success", false, true));
        assertFalse(VoiceCuePolicy.shouldPlayDoneCue("android_wake_word", "unsupported", "success", false, true));
        assertFalse(VoiceCuePolicy.shouldPlayDoneCue("android_wake_word", "get_agenda", "success", false, true));
        assertFalse(VoiceCuePolicy.shouldPlayDoneCue("android_wake_word", "create_task", "success", true, true));
        assertFalse(VoiceCuePolicy.shouldPlayDoneCue("android_wake_word", "create_task", "success", false, false));
        assertFalse(VoiceCuePolicy.shouldPlayDoneCue("web_microphone", "create_task", "success", false, true));
    }
}
