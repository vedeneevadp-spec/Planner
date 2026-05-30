package ru.chaotika.app;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Locale;

final class WakeWordSampleProcessor {

    static final int SAMPLE_RATE = 16_000;
    static final int CHANNEL_COUNT = 1;
    static final int BITS_PER_SAMPLE = 16;
    static final int MIN_DURATION_MS = 450;
    static final int MAX_DURATION_MS = 2_000;

    private static final int SILENCE_PADDING_SAMPLES = (SAMPLE_RATE * 80) / 1_000;
    private static final int MIN_SIGNAL_PEAK = 500;
    private static final int FRAME_SAMPLES = (SAMPLE_RATE * 20) / 1_000;
    private static final int MAX_INACTIVE_GAP_FRAMES = 6;
    private static final int MIN_ACTIVE_RMS = 260;
    private static final float NOISE_RMS_MULTIPLIER = 2.2f;
    private static final int NOISE_RMS_OFFSET = 120;
    private static final float NOISE_PEAK_MULTIPLIER = 1.8f;
    private static final int NOISE_PEAK_OFFSET = 180;
    private static final int HIGH_ENERGY_CONTINUOUS_PEAK = 2_500;
    private static final int HIGH_ENERGY_CONTINUOUS_RMS = 1_500;
    private static final float TARGET_PEAK_RATIO = 0.86f;

    private WakeWordSampleProcessor() {}

    static ProcessedSample process(short[] samples, int sampleCount) throws ValidationException {
        if (samples == null || sampleCount <= 0) {
            throw new ValidationException("Запись пустая.");
        }

        int boundedSampleCount = Math.min(sampleCount, samples.length);
        int peak = findPeak(samples, 0, boundedSampleCount);

        if (peak < MIN_SIGNAL_PEAK) {
            throw new ValidationException("Запись слишком тихая. Поднесите телефон ближе и повторите.");
        }

        VoiceSegment voiceSegment = findVoiceSegment(samples, boundedSampleCount);

        if (voiceSegment == null) {
            throw new ValidationException("Не удалось найти голос в записи. Поднесите телефон ближе к микрофону.");
        }

        int trimStart = Math.max(0, voiceSegment.startSample - SILENCE_PADDING_SAMPLES);
        int trimEndExclusive = Math.min(boundedSampleCount, voiceSegment.endSampleExclusive + SILENCE_PADDING_SAMPLES);
        int trimmedLength = trimEndExclusive - trimStart;
        int trimmedDurationMs = toDurationMs(trimmedLength);

        if (trimmedDurationMs < MIN_DURATION_MS) {
            throw new ValidationException("Слишком коротко. Скажите “Хаотика” целиком.");
        }

        if (trimmedDurationMs > MAX_DURATION_MS) {
            throw new ValidationException("Слишком длинно. Нужна только короткая фраза “Хаотика”.");
        }

        short[] trimmed = new short[trimmedLength];
        System.arraycopy(samples, trimStart, trimmed, 0, trimmedLength);

        return new ProcessedSample(normalize(trimmed));
    }

    static String normalizeSpeakerId(String value) {
        String trimmed = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);

        if (trimmed.isEmpty()) {
            return "speaker_001";
        }

        if (trimmed.matches("\\d+")) {
            return String.format(Locale.ROOT, "speaker_%03d", Integer.parseInt(trimmed));
        }

        String normalized = trimmed.replaceAll("[^a-z0-9_]+", "_").replaceAll("_+", "_");

        if (normalized.startsWith("_")) {
            normalized = normalized.substring(1);
        }

        if (normalized.endsWith("_")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }

        if (normalized.isEmpty()) {
            return "speaker_001";
        }

        return normalized.startsWith("speaker_") ? normalized : "speaker_" + normalized;
    }

    static String buildFileName(String speakerId, int sampleIndex) {
        return String.format(Locale.ROOT, "%s_%03d.wav", normalizeSpeakerId(speakerId), sampleIndex);
    }

    static void writeWav(File file, short[] samples) throws IOException {
        try (FileOutputStream output = new FileOutputStream(file)) {
            writeWav(output, samples);
        }
    }

    static void writeWav(OutputStream output, short[] samples) throws IOException {
        int dataSize = samples.length * 2;
        int byteRate = SAMPLE_RATE * CHANNEL_COUNT * BITS_PER_SAMPLE / 8;
        int blockAlign = CHANNEL_COUNT * BITS_PER_SAMPLE / 8;

        output.write("RIFF".getBytes(StandardCharsets.US_ASCII));
        writeLittleEndianInt(output, 36 + dataSize);
        output.write("WAVE".getBytes(StandardCharsets.US_ASCII));
        output.write("fmt ".getBytes(StandardCharsets.US_ASCII));
        writeLittleEndianInt(output, 16);
        writeLittleEndianShort(output, 1);
        writeLittleEndianShort(output, CHANNEL_COUNT);
        writeLittleEndianInt(output, SAMPLE_RATE);
        writeLittleEndianInt(output, byteRate);
        writeLittleEndianShort(output, blockAlign);
        writeLittleEndianShort(output, BITS_PER_SAMPLE);
        output.write("data".getBytes(StandardCharsets.US_ASCII));
        writeLittleEndianInt(output, dataSize);

        for (short sample : samples) {
            writeLittleEndianShort(output, sample);
        }
    }

    private static int findPeak(short[] samples, int start, int endExclusive) {
        int peak = 0;

        for (int index = start; index < endExclusive; index += 1) {
            peak = Math.max(peak, Math.abs(samples[index]));
        }

        return peak;
    }

    private static short[] normalize(short[] samples) {
        int peak = findPeak(samples, 0, samples.length);

        if (peak == 0) {
            return samples;
        }

        float targetPeak = Short.MAX_VALUE * TARGET_PEAK_RATIO;
        float gain = targetPeak / peak;
        short[] normalized = new short[samples.length];

        for (int index = 0; index < samples.length; index += 1) {
            int value = Math.round(samples[index] * gain);
            normalized[index] = (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, value));
        }

        return normalized;
    }

    private static int toDurationMs(int sampleCount) {
        return Math.round((sampleCount * 1_000f) / SAMPLE_RATE);
    }

    private static VoiceSegment findVoiceSegment(short[] samples, int sampleCount) {
        FrameStats[] frames = analyzeFrames(samples, sampleCount);

        if (frames.length == 0) {
            return null;
        }

        NoiseFloor noiseFloor = estimateNoiseFloor(frames);
        int rmsThreshold = Math.max(
            MIN_ACTIVE_RMS,
            Math.round(noiseFloor.rms * NOISE_RMS_MULTIPLIER) + NOISE_RMS_OFFSET
        );
        int peakThreshold = Math.max(
            MIN_SIGNAL_PEAK,
            Math.round(noiseFloor.peak * NOISE_PEAK_MULTIPLIER) + NOISE_PEAK_OFFSET
        );
        boolean[] activeFrames = new boolean[frames.length];

        for (int index = 0; index < frames.length; index += 1) {
            FrameStats frame = frames[index];
            activeFrames[index] = frame.rms >= rmsThreshold || frame.peak >= peakThreshold;
        }

        VoiceSegment segment = findBestSegment(frames, activeFrames, rmsThreshold, peakThreshold);

        if (
            segment == null &&
            (noiseFloor.peak >= HIGH_ENERGY_CONTINUOUS_PEAK || noiseFloor.rms >= HIGH_ENERGY_CONTINUOUS_RMS)
        ) {
            return new VoiceSegment(0, sampleCount, 1L);
        }

        return segment;
    }

    private static FrameStats[] analyzeFrames(short[] samples, int sampleCount) {
        int frameCount = (sampleCount + FRAME_SAMPLES - 1) / FRAME_SAMPLES;
        FrameStats[] frames = new FrameStats[frameCount];

        for (int frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
            int start = frameIndex * FRAME_SAMPLES;
            int endExclusive = Math.min(sampleCount, start + FRAME_SAMPLES);
            int peak = 0;
            long sumSquares = 0L;

            for (int sampleIndex = start; sampleIndex < endExclusive; sampleIndex += 1) {
                int sample = samples[sampleIndex];
                int absolute = Math.abs(sample);

                peak = Math.max(peak, absolute);
                sumSquares += (long) sample * sample;
            }

            int frameLength = Math.max(1, endExclusive - start);
            int rms = Math.round((float) Math.sqrt(sumSquares / (double) frameLength));
            frames[frameIndex] = new FrameStats(start, endExclusive, peak, rms);
        }

        return frames;
    }

    private static NoiseFloor estimateNoiseFloor(FrameStats[] frames) {
        int[] rmsValues = new int[frames.length];
        int[] peakValues = new int[frames.length];

        for (int index = 0; index < frames.length; index += 1) {
            rmsValues[index] = frames[index].rms;
            peakValues[index] = frames[index].peak;
        }

        Arrays.sort(rmsValues);
        Arrays.sort(peakValues);

        int quartileIndex = Math.max(0, Math.min(frames.length - 1, frames.length / 4));

        return new NoiseFloor(rmsValues[quartileIndex], peakValues[quartileIndex]);
    }

    private static VoiceSegment findBestSegment(
        FrameStats[] frames,
        boolean[] activeFrames,
        int rmsThreshold,
        int peakThreshold
    ) {
        VoiceSegment bestSegment = null;
        int index = 0;

        while (index < frames.length) {
            while (index < frames.length && !activeFrames[index]) {
                index += 1;
            }

            if (index >= frames.length) {
                break;
            }

            int startFrame = index;
            int lastActiveFrame = index;
            int inactiveGapFrames = 0;
            long score = 0L;

            while (index < frames.length) {
                if (activeFrames[index]) {
                    FrameStats frame = frames[index];

                    lastActiveFrame = index;
                    inactiveGapFrames = 0;
                    score += Math.max(1, frame.rms - rmsThreshold);
                    score += Math.max(1, (frame.peak - peakThreshold) / 2);
                } else {
                    inactiveGapFrames += 1;

                    if (inactiveGapFrames > MAX_INACTIVE_GAP_FRAMES) {
                        break;
                    }
                }

                index += 1;
            }

            VoiceSegment segment = new VoiceSegment(
                frames[startFrame].startSample,
                frames[lastActiveFrame].endSampleExclusive,
                score
            );

            if (bestSegment == null || segment.score > bestSegment.score) {
                bestSegment = segment;
            }
        }

        return bestSegment;
    }

    private static void writeLittleEndianInt(OutputStream output, int value) throws IOException {
        output.write(value & 0xff);
        output.write((value >> 8) & 0xff);
        output.write((value >> 16) & 0xff);
        output.write((value >> 24) & 0xff);
    }

    private static void writeLittleEndianShort(OutputStream output, int value) throws IOException {
        output.write(value & 0xff);
        output.write((value >> 8) & 0xff);
    }

    static final class ProcessedSample {

        final short[] samples;
        final int durationMs;

        private ProcessedSample(short[] samples) {
            this.samples = samples;
            durationMs = toDurationMs(samples.length);
        }
    }

    static final class ValidationException extends Exception {

        ValidationException(String message) {
            super(message);
        }
    }

    private static final class FrameStats {

        final int startSample;
        final int endSampleExclusive;
        final int peak;
        final int rms;

        FrameStats(int startSample, int endSampleExclusive, int peak, int rms) {
            this.startSample = startSample;
            this.endSampleExclusive = endSampleExclusive;
            this.peak = peak;
            this.rms = rms;
        }
    }

    private static final class NoiseFloor {

        final int rms;
        final int peak;

        NoiseFloor(int rms, int peak) {
            this.rms = rms;
            this.peak = peak;
        }
    }

    private static final class VoiceSegment {

        final int startSample;
        final int endSampleExclusive;
        final long score;

        VoiceSegment(int startSample, int endSampleExclusive, long score) {
            this.startSample = startSample;
            this.endSampleExclusive = endSampleExclusive;
            this.score = score;
        }
    }
}
