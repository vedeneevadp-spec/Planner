package ru.chaotika.app;

interface SpeechToTextService {
    interface Callback {
        void onTranscript(String transcript);

        void onError(Exception error);
    }

    void captureShortCommand(Callback callback);

    void stop();
}
