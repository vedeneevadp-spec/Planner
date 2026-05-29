package ru.chaotika.app;

enum VoiceAssistantState {
    IDLE("idle"),
    LISTENING_FOR_WAKE_WORD("wake_listening"),
    WAKE_WORD_DETECTED("wake_word_detected"),
    REVIEWING_WAKE_WORD("wake_review"),
    RECORDING_COMMAND("recording"),
    TRANSCRIBING("transcribing"),
    WAITING_FOR_CONFIRMATION("awaiting_confirmation"),
    ERROR("error");

    final String value;

    VoiceAssistantState(String value) {
        this.value = value;
    }
}
