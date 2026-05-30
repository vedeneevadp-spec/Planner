package ru.chaotika.app;

enum AndroidVoiceRuntimeStatus {
    DISABLED("disabled"),
    STARTING("starting"),
    RUNNING_FOREGROUND("running_foreground"),
    LISTENING_WAKE_WORD("listening_wake_word"),
    PAUSED_FOR_COMMAND("paused_for_command"),
    PLAYING_LISTENING_CUE("playing_listening_cue"),
    RECORDING_COMMAND("recording_command"),
    STOPPING("stopping"),
    STOPPED("stopped"),
    BLOCKED("blocked");

    final String value;

    AndroidVoiceRuntimeStatus(String value) {
        this.value = value;
    }

    static AndroidVoiceRuntimeStatus fromValue(String value) {
        for (AndroidVoiceRuntimeStatus status : values()) {
            if (status.value.equals(value)) {
                return status;
            }
        }

        return STOPPED;
    }
}
