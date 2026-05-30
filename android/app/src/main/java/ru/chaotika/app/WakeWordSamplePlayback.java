package ru.chaotika.app;

import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Handler;
import android.os.Looper;

final class WakeWordSamplePlayback {

    interface Callback {
        void onFinished();
        void onError(String message);
    }

    private WakeWordSamplePlayback() {}

    static void play(short[] samples, int sampleRate, Callback callback) {
        if (samples == null || samples.length == 0 || sampleRate <= 0) {
            callback.onError("Фрагмент для прослушивания недоступен.");
            return;
        }

        short[] playbackSamples = samples.clone();
        Handler mainHandler = new Handler(Looper.getMainLooper());

        new Thread(
            () -> playBlocking(playbackSamples, sampleRate, callback, mainHandler),
            "wake-word-sample-playback"
        ).start();
    }

    @SuppressWarnings("deprecation")
    private static void playBlocking(short[] samples, int sampleRate, Callback callback, Handler mainHandler) {
        AudioTrack audioTrack = null;

        try {
            int minBufferSize = AudioTrack.getMinBufferSize(
                sampleRate,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT
            );
            int bufferSizeBytes = Math.max(minBufferSize, samples.length * 2);

            audioTrack = new AudioTrack(
                AudioManager.STREAM_MUSIC,
                sampleRate,
                AudioFormat.CHANNEL_OUT_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSizeBytes,
                AudioTrack.MODE_STATIC
            );

            int writtenSamples = audioTrack.write(samples, 0, samples.length);

            if (writtenSamples <= 0) {
                throw new IllegalStateException("AudioTrack write failed.");
            }

            audioTrack.play();

            long durationMs = Math.max(120L, Math.round((writtenSamples * 1_000f) / sampleRate) + 140L);
            Thread.sleep(durationMs);
            mainHandler.post(callback::onFinished);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            mainHandler.post(callback::onFinished);
        } catch (Exception error) {
            mainHandler.post(() -> callback.onError("Не удалось воспроизвести фрагмент."));
        } finally {
            if (audioTrack != null) {
                try {
                    audioTrack.stop();
                } catch (IllegalStateException ignored) {
                    // Playback may already be stopped or not fully initialized.
                }

                audioTrack.release();
            }
        }
    }
}
