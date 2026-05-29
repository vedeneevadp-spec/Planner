package ru.chaotika.app;

interface RecordedSpeechToTextProvider {
    boolean isAvailable();

    SttResult transcribe(CommandAudio audio, SttSource source) throws SttException;
}
