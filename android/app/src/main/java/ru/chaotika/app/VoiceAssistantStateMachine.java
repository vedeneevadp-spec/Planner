package ru.chaotika.app;

final class VoiceAssistantStateMachine {

    private VoiceAssistantStateMachine() {}

    static VoiceAssistantState onWakeWordDetected(VoiceAssistantState currentState) {
        if (currentState != VoiceAssistantState.LISTENING_FOR_WAKE_WORD) {
            return currentState;
        }

        return VoiceAssistantState.REVIEWING_WAKE_WORD;
    }
}
