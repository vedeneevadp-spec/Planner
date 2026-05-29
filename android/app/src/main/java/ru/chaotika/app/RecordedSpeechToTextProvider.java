package ru.chaotika.app;

interface RecordedSpeechToTextProvider {
    boolean isAvailable();

    SttResult transcribe(CommandAudio audio, SttRequest request) throws SttException;
}
