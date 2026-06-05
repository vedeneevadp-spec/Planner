package ru.chaotika.app;

final class Pcm16AudioActivity {

    private static final int SILENCE_ABSOLUTE_PEAK = 12;
    private static final int QUIET_ABSOLUTE_PEAK = 420;
    private static final int VOICE_ABSOLUTE_PEAK = 700;
    private static final double QUIET_RMS = 0.0035d;
    private static final double VOICE_RMS = 0.006d;
    private static final double VOICED_SAMPLE_RATIO = 0.006d;

    private Pcm16AudioActivity() {}

    static Result analyzeRange(byte[] data, int offset, int byteLength) {
        if (
            data == null ||
            offset < 0 ||
            byteLength <= 0 ||
            offset >= data.length ||
            offset + byteLength > data.length
        ) {
            return Result.empty();
        }

        int safeByteLength = byteLength - (byteLength % 2);
        if (safeByteLength <= 0) {
            return Result.empty();
        }

        int peak = 0;
        long sumSquares = 0L;
        int activeSamples = 0;
        int voicedSamples = 0;
        int sampleCount = safeByteLength / 2;

        for (int cursor = offset; cursor < offset + safeByteLength; cursor += 2) {
            int sample = (short) ((data[cursor] & 0xff) | (data[cursor + 1] << 8));
            int absolute = Math.abs(sample);

            peak = Math.max(peak, absolute);
            sumSquares += (long) sample * sample;

            if (absolute >= QUIET_ABSOLUTE_PEAK) {
                activeSamples += 1;
            }

            if (absolute >= VOICE_ABSOLUTE_PEAK) {
                voicedSamples += 1;
            }
        }

        double rms = Math.sqrt(sumSquares / (double) sampleCount) / 32768d;
        double activeRatio = activeSamples / (double) sampleCount;
        double voicedRatio = voicedSamples / (double) sampleCount;
        boolean isSilent = peak <= SILENCE_ABSOLUTE_PEAK;
        boolean isTooQuiet = peak < QUIET_ABSOLUTE_PEAK || rms < QUIET_RMS;
        boolean hasVoiceActivity = peak >= VOICE_ABSOLUTE_PEAK && rms >= VOICE_RMS && voicedRatio >= VOICED_SAMPLE_RATIO;

        return new Result(hasVoiceActivity, isSilent, isTooQuiet, peak, rms, activeRatio, voicedRatio);
    }

    static final class Result {

        final boolean hasVoiceActivity;
        final boolean isSilent;
        final boolean isTooQuiet;
        final double activeRatio;
        final int peak;
        final double rms;
        final double voicedRatio;

        Result(
            boolean hasVoiceActivity,
            boolean isSilent,
            boolean isTooQuiet,
            int peak,
            double rms,
            double activeRatio,
            double voicedRatio
        ) {
            this.hasVoiceActivity = hasVoiceActivity;
            this.isSilent = isSilent;
            this.isTooQuiet = isTooQuiet;
            this.peak = peak;
            this.rms = rms;
            this.activeRatio = activeRatio;
            this.voicedRatio = voicedRatio;
        }

        static Result empty() {
            return new Result(false, true, true, 0, 0d, 0d, 0d);
        }
    }
}
