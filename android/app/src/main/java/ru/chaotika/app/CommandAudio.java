package ru.chaotika.app;

import java.util.Arrays;

final class CommandAudio {

    private static final int SILENCE_ABSOLUTE_PEAK = 12;
    private static final int QUIET_ABSOLUTE_PEAK = 420;
    private static final int VOICE_ABSOLUTE_PEAK = 700;
    private static final double QUIET_RMS = 0.0035d;
    private static final double VOICE_RMS = 0.006d;
    private static final double VOICED_SAMPLE_RATIO = 0.006d;

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

        AudioActivity mainActivity = analyzeRange(source, mainAudioOffset, mainByteLength);

        if (mainActivity.peak <= SILENCE_ABSOLUTE_PEAK || mainActivity.voicedRatio == 0d) {
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

    private static AudioActivity analyzeRange(byte[] data, int offset, int byteLength) {
        if (
            data == null ||
            offset < 0 ||
            byteLength <= 0 ||
            offset >= data.length ||
            offset + byteLength > data.length
        ) {
            return new AudioActivity(false, true, 0, 0d);
        }

        int safeByteLength = byteLength - (byteLength % 2);
        if (safeByteLength <= 0) {
            return new AudioActivity(false, true, 0, 0d);
        }

        int peak = 0;
        long sumSquares = 0L;
        int voicedSamples = 0;
        int sampleCount = safeByteLength / 2;

        for (int cursor = offset; cursor < offset + safeByteLength; cursor += 2) {
            int sample = (short) ((data[cursor] & 0xff) | (data[cursor + 1] << 8));
            int absolute = Math.abs(sample);

            peak = Math.max(peak, absolute);
            sumSquares += (long) sample * sample;

            if (absolute >= VOICE_ABSOLUTE_PEAK) {
                voicedSamples += 1;
            }
        }

        double rms = Math.sqrt(sumSquares / (double) sampleCount) / 32768d;
        double voicedRatio = voicedSamples / (double) sampleCount;
        boolean isTooQuiet = peak < QUIET_ABSOLUTE_PEAK || rms < QUIET_RMS;
        boolean hasVoiceActivity = peak >= VOICE_ABSOLUTE_PEAK && rms >= VOICE_RMS && voicedRatio >= VOICED_SAMPLE_RATIO;

        return new AudioActivity(hasVoiceActivity, isTooQuiet, peak, voicedRatio);
    }

    private static final class AudioActivity {

        final boolean hasVoiceActivity;
        final boolean isTooQuiet;
        final int peak;
        final double voicedRatio;

        AudioActivity(boolean hasVoiceActivity, boolean isTooQuiet, int peak, double voicedRatio) {
            this.hasVoiceActivity = hasVoiceActivity;
            this.isTooQuiet = isTooQuiet;
            this.peak = peak;
            this.voicedRatio = voicedRatio;
        }
    }
}
