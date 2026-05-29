package ru.chaotika.app;

import android.content.Context;

final class SpeechToTextServiceFactory {

    private SpeechToTextServiceFactory() {}

    static SpeechToTextService create(Context context) {
        Context applicationContext = context.getApplicationContext();

        return new HybridSpeechToTextService(
            applicationContext,
            new CommandAudioRecorder(applicationContext),
            new BackendSpeechToTextService(applicationContext),
            new LocalSpeechToTextServiceStub()
        );
    }
}
