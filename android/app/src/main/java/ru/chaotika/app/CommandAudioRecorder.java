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
    private static final long START_SIGNAL_CAPTURE_GUARD_MS = 30L;

    private final Context context;
    private volatile AudioRecord activeRecord;
    private volatile boolean isStopped;

    CommandAudioRecorder(Context context) {
        this.context = context.getApplicationContext();
    }

    @SuppressLint("MissingPermission")
    CommandAudio recordBlocking(CommandRecordingConfig config) throws SttException {
        return recordBlocking(new SttRequest(config, SttSource.TEST_STUB, false, true), null);
    }

    @SuppressLint("MissingPermission")
    CommandAudio recordBlocking(CommandRecordingConfig config, CommandRecordingObserver observer) throws SttException {
        return recordBlocking(new SttRequest(config, SttSource.TEST_STUB, false, true), observer);
    }

    @SuppressLint("MissingPermission")
    CommandAudio recordBlocking(SttRequest request, CommandRecordingObserver observer) throws SttException {
        CommandRecordingConfig config = request.recordingConfig;
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
        CommandAudioPreBuffer preBuffer = compatiblePreBuffer(request, config);
        if (preBuffer.pcm16le.length > 0) {
            output.write(preBuffer.pcm16le, 0, preBuffer.pcm16le.length);
        }
        int maxMainDurationMs = Math.max(0, config.maxDurationMs - preBuffer.durationMs);
        int mainAudioOffset = output.size();
        byte[] buffer = new byte[frameBytes];
        long recordingStartedAtMs = SystemClock.elapsedRealtime();
        CommandRecordingVad vad = new CommandRecordingVad(config, recordingStartedAtMs);

        try {
            recorder.startRecording();
            recordingStartedAtMs = SystemClock.elapsedRealtime();
            vad = new CommandRecordingVad(config, recordingStartedAtMs);

            if (observer != null) {
                observer.onRecorderStarted(recordingStartedAtMs);
            }

            while (!isStopped) {
                long nowMs = SystemClock.elapsedRealtime();
                int elapsedMs = (int) (nowMs - recordingStartedAtMs);

                if (elapsedMs >= maxMainDurationMs) {
                    break;
                }

                int read = recorder.read(buffer, 0, buffer.length);

                if (read <= 0) {
                    continue;
                }

                if (isAudioSignalFrame(request, nowMs)) {
                    continue;
                }

                output.write(buffer, 0, read);

                Pcm16AudioActivity.Result frameActivity = Pcm16AudioActivity.analyzeRange(buffer, 0, read);
                vad.observe(frameActivity, nowMs);

                if (vad.shouldStop(nowMs, elapsedMs)) {
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
        int mainByteLength = audio.length - mainAudioOffset;
        int recordingDurationMs = Math.round((mainByteLength * 1000f) / (config.sampleRateHertz * 2f));

        return CommandAudio.fromPcm16Le(
            audio,
            audio.length,
            config,
            preBuffer.durationMs,
            recordingDurationMs,
            mainAudioOffset,
            mainByteLength
        );
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

    private static CommandAudioPreBuffer compatiblePreBuffer(
        SttRequest request,
        CommandRecordingConfig config
    ) {
        CommandAudioPreBuffer preBuffer = request.preBuffer;

        if (preBuffer == null || !preBuffer.isCompatibleWith(config)) {
            return CommandAudioPreBuffer.empty(config.sampleRateHertz);
        }

        return preBuffer;
    }

    private static boolean isAudioSignalFrame(SttRequest request, long frameReadAtElapsedMs) {
        if (
            !request.audioSignalPlayed ||
            request.audioSignalStartedAtElapsedMs <= 0L ||
            request.audioSignalDurationMs <= 0
        ) {
            return false;
        }

        long guardedUntilElapsedMs =
            request.audioSignalStartedAtElapsedMs +
            request.audioSignalDurationMs +
            START_SIGNAL_CAPTURE_GUARD_MS;

        return frameReadAtElapsedMs <= guardedUntilElapsedMs;
    }
}
