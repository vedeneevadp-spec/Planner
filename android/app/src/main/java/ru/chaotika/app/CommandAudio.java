package ru.chaotika.app;

import java.util.Arrays;

final class CommandAudio {

    final int bitsPerSample = CommandRecordingConfig.BITS_PER_SAMPLE;
    final String byteOrder = CommandRecordingConfig.BYTE_ORDER;
    final int channelCount = CommandRecordingConfig.CHANNEL_COUNT;
    final int durationMs;
    final String encoding = CommandRecordingConfig.ENCODING;
    final boolean hasVoiceActivity;
    final boolean isTooQuiet;
    final byte[] pcm16le;
    final int preBufferMs;
    final int recordingDurationMs;
    final int sampleRateHertz;

    private CommandAudio(
        byte[] pcm16le,
        int sampleRateHertz,
        int durationMs,
        int recordingDurationMs,
        int preBufferMs,
        boolean hasVoiceActivity,
        boolean isTooQuiet
    ) {
        this.pcm16le = pcm16le;
        this.sampleRateHertz = sampleRateHertz;
        this.durationMs = durationMs;
        this.recordingDurationMs = Math.max(0, recordingDurationMs);
        this.preBufferMs = Math.max(0, preBufferMs);
        this.hasVoiceActivity = hasVoiceActivity;
        this.isTooQuiet = isTooQuiet;
    }

    static CommandAudio fromPcm16Le(
        byte[] source,
        int byteLength,
        CommandRecordingConfig config
    ) throws SttException {
        return fromPcm16Le(source, byteLength, config, 0, 0, 0, byteLength);
    }

    static CommandAudio fromPcm16Le(
        byte[] source,
        int byteLength,
        CommandRecordingConfig config,
        int preBufferMs,
        int recordingDurationMs,
        int mainAudioOffset,
        int mainByteLength
    ) throws SttException {
        if (source == null || byteLength <= 0 || byteLength > source.length || byteLength % 2 != 0) {
            throw new SttException(
                SttError.UNSUPPORTED_AUDIO_FORMAT,
                "Нужен PCM/LPCM 16 kHz mono 16-bit little-endian."
            );
        }

        int bytesPerSecond =
            config.sampleRateHertz * CommandRecordingConfig.CHANNEL_COUNT * (CommandRecordingConfig.BITS_PER_SAMPLE / 8);
        int durationMs = Math.round((byteLength * 1000f) / bytesPerSecond);

        if (durationMs < config.minDurationMs) {
            throw new SttException(SttError.TOO_SHORT, "Команда слишком короткая.");
        }

        if (durationMs > config.maxDurationMs) {
            throw new SttException(SttError.TOO_LONG, "Команда слишком длинная.");
        }

        Pcm16AudioActivity.Result mainActivity = Pcm16AudioActivity.analyzeRange(source, mainAudioOffset, mainByteLength);

        if (mainActivity.isSilent) {
            throw new SttException(SttError.NO_SPEECH, "Речь не обнаружена.");
        }

        if (mainActivity.isTooQuiet) {
            throw new SttException(SttError.TOO_QUIET, "Запись слишком тихая.");
        }

        if (!mainActivity.hasVoiceActivity) {
            throw new SttException(SttError.NO_SPEECH, "Речь не обнаружена.");
        }

        return new CommandAudio(
            Arrays.copyOf(source, byteLength),
            config.sampleRateHertz,
            durationMs,
            recordingDurationMs > 0 ? recordingDurationMs : durationMs,
            preBufferMs,
            true,
            false
        );
    }

    int byteLength() {
        return pcm16le.length;
    }
}
