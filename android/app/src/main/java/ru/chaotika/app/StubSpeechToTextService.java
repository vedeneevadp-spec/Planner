package ru.chaotika.app;

import android.os.Handler;
import android.os.Looper;

final class StubSpeechToTextService implements SpeechToTextService {

    private static final long STUB_TRANSCRIPT_DELAY_MS = 450L;
    private static final String STUB_TRANSCRIPT = "добавь задачу проверить голосового помощника";
    private static final byte[] STUB_AUDIO = createStubAudio();

    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable pendingResult;

    @Override
    public void transcribe(SttRequest request, Callback callback) {
        stop();
        pendingResult = () -> {
            pendingResult = null;
            try {
                CommandAudio audio = CommandAudio.fromPcm16Le(
                    STUB_AUDIO,
                    STUB_AUDIO.length,
                    request.recordingConfig
                );
                callback.onRecordingStopped(audio);
                callback.onResult(
                    new SttResult(
                        STUB_TRANSCRIPT,
                        1d,
                        SttProvider.STUB,
                        SttSource.TEST_STUB,
                        audio.durationMs,
                        null
                    )
                );
            } catch (SttException error) {
                callback.onError(error);
            }
        };
        handler.postDelayed(pendingResult, STUB_TRANSCRIPT_DELAY_MS);
    }

    @Override
    public void stop() {
        if (pendingResult != null) {
            handler.removeCallbacks(pendingResult);
            pendingResult = null;
        }
    }

    private static byte[] createStubAudio() {
        int sampleRate = CommandRecordingConfig.DEFAULT_SAMPLE_RATE_HERTZ;
        int durationMs = CommandRecordingConfig.DEFAULT_MIN_DURATION_MS;
        int sampleCount = (sampleRate * durationMs) / 1000;
        byte[] audio = new byte[sampleCount * 2];

        for (int index = 0; index < sampleCount; index++) {
            short sample = (short) (Math.sin(index / 6d) * 2400);
            audio[index * 2] = (byte) (sample & 0xff);
            audio[index * 2 + 1] = (byte) ((sample >> 8) & 0xff);
        }

        return audio;
    }
}
