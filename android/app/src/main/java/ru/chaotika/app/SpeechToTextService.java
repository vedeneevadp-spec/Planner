package ru.chaotika.app;

interface SpeechToTextService {
    interface Callback {
        void onRecordingStopped(CommandAudio audio);

        void onResult(SttResult result);

        void onError(SttException error);
    }

    void transcribe(SttRequest request, Callback callback);

    void stop();
}
