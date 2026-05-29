package ru.chaotika.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.SystemClock;
import java.io.ByteArrayOutputStream;

final class CommandAudioRecorder {

    private static final int FRAME_DURATION_MS = 40;
    private static final int VOICE_ABSOLUTE_PEAK = 700;

    private final Context context;
    private volatile AudioRecord activeRecord;
    private volatile boolean isStopped;

    CommandAudioRecorder(Context context) {
        this.context = context.getApplicationContext();
    }

    @SuppressLint("MissingPermission")
    CommandAudio recordBlocking(CommandRecordingConfig config) throws SttException {
        ensureMicrophonePermission();
        stop();
        isStopped = false;

        int minBufferSize = AudioRecord.getMinBufferSize(
            config.sampleRateHertz,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        );

        if (minBufferSize <= 0) {
            throw new SttException(
                SttError.UNSUPPORTED_AUDIO_FORMAT,
                "Устройство не поддерживает PCM 16 kHz mono recording."
            );
        }

        int frameBytes = Math.max(320, (config.sampleRateHertz * 2 * FRAME_DURATION_MS) / 1000);
        int bufferSize = Math.max(minBufferSize, frameBytes * 2);
        AudioRecord recorder = new AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            config.sampleRateHertz,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize
        );

        if (recorder.getState() != AudioRecord.STATE_INITIALIZED) {
            recorder.release();
            throw new SttException(
                SttError.UNSUPPORTED_AUDIO_FORMAT,
                "Не удалось инициализировать запись PCM."
            );
        }

        activeRecord = recorder;
        ByteArrayOutputStream output = new ByteArrayOutputStream(
            (config.sampleRateHertz * 2 * config.maxDurationMs) / 1000
        );
        byte[] buffer = new byte[frameBytes];
        boolean hasVoice = false;
        long recordingStartedAtMs = SystemClock.elapsedRealtime();
        long lastVoiceAtMs = recordingStartedAtMs;

        try {
            recorder.startRecording();

            while (!isStopped) {
                long nowMs = SystemClock.elapsedRealtime();
                int elapsedMs = (int) (nowMs - recordingStartedAtMs);

                if (elapsedMs >= config.maxDurationMs) {
                    break;
                }

                int read = recorder.read(buffer, 0, buffer.length);

                if (read <= 0) {
                    continue;
                }

                output.write(buffer, 0, read);

                if (!config.vadEnabled || hasVoiceActivity(buffer, read)) {
                    hasVoice = true;
                    lastVoiceAtMs = nowMs;
                }

                if (hasVoice && nowMs - lastVoiceAtMs >= config.silenceTimeoutMs) {
                    break;
                }
            }
        } finally {
            try {
                recorder.stop();
            } catch (IllegalStateException ignored) {
                // The recorder can be stopped externally while read() is active.
            }
            recorder.release();
            activeRecord = null;
        }

        byte[] audio = output.toByteArray();

        return CommandAudio.fromPcm16Le(audio, audio.length, config);
    }

    void stop() {
        isStopped = true;
        AudioRecord recorder = activeRecord;

        if (recorder != null) {
            try {
                recorder.stop();
            } catch (IllegalStateException ignored) {
                // Safe best-effort stop for service shutdown.
            }
        }
    }

    private void ensureMicrophonePermission() throws SttException {
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            throw new SttException(SttError.PERMISSION_DENIED, "Нет доступа к микрофону.");
        }
    }

    private static boolean hasVoiceActivity(byte[] data, int byteLength) {
        for (int offset = 0; offset + 1 < byteLength; offset += 2) {
            int sample = (short) ((data[offset] & 0xff) | (data[offset + 1] << 8));

            if (Math.abs(sample) >= VOICE_ABSOLUTE_PEAK) {
                return true;
            }
        }

        return false;
    }
}
