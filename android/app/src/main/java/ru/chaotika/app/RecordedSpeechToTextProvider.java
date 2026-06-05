package ru.chaotika.app;

interface RecordedSpeechToTextProvider {
    default void cancel() {}

    boolean isAvailable();

    SttResult transcribe(CommandAudio audio, SttRequest request) throws SttException;
}
