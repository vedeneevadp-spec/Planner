package ru.chaotika.app;

final class AudioSignalPolicy {

    private AudioSignalPolicy() {}

    static boolean shouldPlaySuccessSignal(
        String source,
        String intent,
        String resultStatus,
        boolean requiresUnlock,
        boolean changedData
    ) {
        if (!isAndroidVoiceSource(source) || !"success".equals(resultStatus) || requiresUnlock || !changedData) {
            return false;
        }

        return (
            "create_task".equals(intent) ||
            "add_shopping_item".equals(intent) ||
            "reschedule_task".equals(intent)
        );
    }

    private static boolean isAndroidVoiceSource(String source) {
        return "android_wake_word".equals(source) || "android_microphone".equals(source);
    }
}
