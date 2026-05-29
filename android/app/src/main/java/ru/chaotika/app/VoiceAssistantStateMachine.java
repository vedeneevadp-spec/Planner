package ru.chaotika.app;

final class VoiceAssistantStateMachine {

    private VoiceAssistantStateMachine() {}

    static VoiceAssistantState onWakeWordDetected(VoiceAssistantState currentState) {
        if (currentState != VoiceAssistantState.LISTENING_FOR_WAKE_WORD) {
            return currentState;
        }

        return VoiceAssistantState.REVIEWING_WAKE_WORD;
    }

    static boolean canStartWakeWordDetection(VoiceAssistantState currentState) {
        return currentState == VoiceAssistantState.IDLE ||
            currentState == VoiceAssistantState.LISTENING_FOR_WAKE_WORD ||
            currentState == VoiceAssistantState.WAITING_FOR_CONFIRMATION ||
            currentState == VoiceAssistantState.ERROR;
    }
}
