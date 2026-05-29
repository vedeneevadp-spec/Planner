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
    final int sampleRateHertz;

    private CommandAudio(
        byte[] pcm16le,
        int sampleRateHertz,
        int durationMs,
        boolean hasVoiceActivity,
        boolean isTooQuiet
    ) {
        this.pcm16le = pcm16le;
        this.sampleRateHertz = sampleRateHertz;
        this.durationMs = durationMs;
        this.hasVoiceActivity = hasVoiceActivity;
        this.isTooQuiet = isTooQuiet;
    }

    static CommandAudio fromPcm16Le(
        byte[] source,
        int byteLength,
        CommandRecordingConfig config
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

        AudioActivity activity = analyze(source, byteLength);

        if (activity.peak <= SILENCE_ABSOLUTE_PEAK || activity.voicedRatio == 0d) {
            throw new SttException(SttError.NO_SPEECH, "Речь не обнаружена.");
        }

        if (activity.isTooQuiet) {
            throw new SttException(SttError.TOO_QUIET, "Запись слишком тихая.");
        }

        if (!activity.hasVoiceActivity) {
            throw new SttException(SttError.NO_SPEECH, "Речь не обнаружена.");
        }

        return new CommandAudio(
            Arrays.copyOf(source, byteLength),
            config.sampleRateHertz,
            durationMs,
            true,
            false
        );
    }

    int byteLength() {
        return pcm16le.length;
    }

    private static AudioActivity analyze(byte[] data, int byteLength) {
        int peak = 0;
        long sumSquares = 0L;
        int voicedSamples = 0;
        int sampleCount = byteLength / 2;

        for (int offset = 0; offset < byteLength; offset += 2) {
            int sample = (short) ((data[offset] & 0xff) | (data[offset + 1] << 8));
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
