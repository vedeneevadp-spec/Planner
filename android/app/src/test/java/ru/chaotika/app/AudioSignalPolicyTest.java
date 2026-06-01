package ru.chaotika.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AudioSignalPolicyTest {

    @Test
    public void playsSuccessSignalOnlyForSuccessfulAndroidMutatingActions() {
        assertTrue(AudioSignalPolicy.shouldPlaySuccessSignal("android_wake_word", "create_task", "success", false, true));
        assertTrue(AudioSignalPolicy.shouldPlaySuccessSignal("android_microphone", "add_shopping_item", "success", false, true));
        assertTrue(AudioSignalPolicy.shouldPlaySuccessSignal("android_microphone", "reschedule_task", "success", false, true));
    }

    @Test
    public void skipsSuccessSignalForPreviewErrorsClarifyUnlockUndoAgendaAndWeb() {
        assertFalse(AudioSignalPolicy.shouldPlaySuccessSignal("android_wake_word", "create_task", "failed", false, true));
        assertFalse(AudioSignalPolicy.shouldPlaySuccessSignal("android_wake_word", "clarify", "success", false, true));
        assertFalse(AudioSignalPolicy.shouldPlaySuccessSignal("android_wake_word", "unsupported", "success", false, true));
        assertFalse(AudioSignalPolicy.shouldPlaySuccessSignal("android_wake_word", "get_agenda", "success", false, true));
        assertFalse(AudioSignalPolicy.shouldPlaySuccessSignal("android_wake_word", "cancel", "success", false, true));
        assertFalse(AudioSignalPolicy.shouldPlaySuccessSignal("android_wake_word", "create_task", "success", true, true));
        assertFalse(AudioSignalPolicy.shouldPlaySuccessSignal("android_wake_word", "create_task", "success", false, false));
        assertFalse(AudioSignalPolicy.shouldPlaySuccessSignal("web_microphone", "create_task", "success", false, true));
    }
}
