package ru.chaotika.app;

final class LocalSpeechToTextServiceStub implements RecordedSpeechToTextProvider {

    @Override
    public boolean isAvailable() {
        return false;
    }

    @Override
    public SttResult transcribe(CommandAudio audio, SttRequest request) throws SttException {
        throw new SttException(
            SttError.LOCAL_STT_UNAVAILABLE,
            "Локальный STT пока не установлен. Можно ввести команду вручную."
        );
    }
}
