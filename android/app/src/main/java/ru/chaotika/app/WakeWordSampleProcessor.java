package ru.chaotika.app;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

final class WakeWordSampleProcessor {

    static final int SAMPLE_RATE = 16_000;
    static final int CHANNEL_COUNT = 1;
    static final int BITS_PER_SAMPLE = 16;
    static final int MIN_DURATION_MS = 450;
    static final int MAX_DURATION_MS = 2_000;

    private static final int SILENCE_PADDING_SAMPLES = (SAMPLE_RATE * 80) / 1_000;
    private static final int MIN_SIGNAL_PEAK = 500;
    private static final float SILENCE_THRESHOLD_RATIO = 0.08f;
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

        int silenceThreshold = Math.max(MIN_SIGNAL_PEAK, Math.round(peak * SILENCE_THRESHOLD_RATIO));
        int firstVoiceSample = findFirstVoiceSample(samples, boundedSampleCount, silenceThreshold);
        int lastVoiceSample = findLastVoiceSample(samples, boundedSampleCount, silenceThreshold);

        if (firstVoiceSample < 0 || lastVoiceSample < firstVoiceSample) {
            throw new ValidationException("Не удалось найти голос в записи.");
        }

        int trimStart = Math.max(0, firstVoiceSample - SILENCE_PADDING_SAMPLES);
        int trimEndExclusive = Math.min(boundedSampleCount, lastVoiceSample + SILENCE_PADDING_SAMPLES + 1);
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

    private static int findFirstVoiceSample(short[] samples, int sampleCount, int threshold) {
        for (int index = 0; index < sampleCount; index += 1) {
            if (Math.abs(samples[index]) >= threshold) {
                return index;
            }
        }

        return -1;
    }

    private static int findLastVoiceSample(short[] samples, int sampleCount, int threshold) {
        for (int index = sampleCount - 1; index >= 0; index -= 1) {
            if (Math.abs(samples[index]) >= threshold) {
                return index;
            }
        }

        return -1;
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
}
