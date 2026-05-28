package ru.chaotika.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

final class WakeWordTrainingExampleStore {

    static final String LABEL_TRUE_ACCEPT = "true_accept";
    static final String LABEL_FALSE_ACCEPT = "false_accept";
    static final String LABEL_FALSE_REJECT = "false_reject";

    private static final String PREFERENCES_NAME = "planner.voice.training-examples";
    private static final String OPT_IN_KEY = "wake-word-training-opt-in";
    private static final String RELATIVE_STORAGE_PATH = "wakeword/haotika/real-world";
    private static final int NOISE_WINDOW_MS = 200;
    private static final Object LOCK = new Object();

    private static PendingWakeWordExample pendingExample;

    private WakeWordTrainingExampleStore() {}

    static boolean isCollectionEnabled(Context context) {
        return preferences(context).getBoolean(OPT_IN_KEY, false);
    }

    static void setCollectionEnabled(Context context, boolean isEnabled) {
        preferences(context).edit().putBoolean(OPT_IN_KEY, isEnabled).apply();

        if (!isEnabled) {
            clearPending();
        }
    }

    static void capturePendingIfAllowed(Context context, WakeWordDetection detection) {
        if (!isCollectionEnabled(context) || detection == null || !detection.hasAudioSamples()) {
            clearPending();
            return;
        }

        synchronized (LOCK) {
            pendingExample = new PendingWakeWordExample(
                detection.detectedAtEpochMillis,
                detection.phraseId,
                detection.displayPhrase,
                detection.score,
                detection.noiseLevelRms,
                detection.sampleRate,
                detection.audioSamples
            );
        }
    }

    static boolean hasPendingExample() {
        synchronized (LOCK) {
            return pendingExample != null;
        }
    }

    static PendingSummary pendingSummary() {
        synchronized (LOCK) {
            if (pendingExample == null) {
                return new PendingSummary(false, 0f, 0f, 0, 0);
            }

            return new PendingSummary(
                true,
                pendingExample.score,
                pendingExample.noiseLevelRms,
                pendingExample.sampleRate,
                pendingExample.samples.length
            );
        }
    }

    static SaveResult savePending(Context context, String label) throws IOException {
        if (!isCollectionEnabled(context)) {
            throw new IOException("Wake-word sample collection is disabled.");
        }

        PendingWakeWordExample example;

        synchronized (LOCK) {
            if (pendingExample == null) {
                throw new IOException("No pending wake-word sample.");
            }

            example = pendingExample;
            pendingExample = null;
        }

        String normalizedLabel = normalizeLabel(label);
        File directory = new File(baseDirectory(context), normalizedLabel);

        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("Failed to create sample directory: " + directory);
        }

        String baseName = buildBaseName(example, normalizedLabel);
        File wavFile = new File(directory, baseName + ".wav");
        File metadataFile = new File(directory, baseName + ".json");

        WakeWordSampleProcessor.writeWav(wavFile, example.samples);
        writeMetadata(metadataFile, example, normalizedLabel, wavFile.getName());

        return new SaveResult(wavFile, metadataFile, normalizedLabel);
    }

    static SaveResult saveFalseReject(Context context, short[] samples) throws IOException {
        if (!isCollectionEnabled(context)) {
            throw new IOException("Wake-word sample collection is disabled.");
        }

        WakeWordConfig config = WakeWordConfig.haotika();
        WakeWordDiagnosticsSnapshot snapshot = WakeWordDiagnostics.snapshot();
        PendingWakeWordExample example = new PendingWakeWordExample(
            System.currentTimeMillis(),
            config.phraseId,
            config.displayPhrase,
            snapshot.currentScore,
            estimateNoiseLevelRms(samples, config.sampleRate),
            config.sampleRate,
            samples
        );
        File directory = new File(baseDirectory(context), LABEL_FALSE_REJECT);

        if (!directory.exists() && !directory.mkdirs()) {
            throw new IOException("Failed to create sample directory: " + directory);
        }

        String baseName = buildBaseName(example, LABEL_FALSE_REJECT);
        File wavFile = new File(directory, baseName + ".wav");
        File metadataFile = new File(directory, baseName + ".json");

        WakeWordSampleProcessor.writeWav(wavFile, example.samples);
        writeMetadata(metadataFile, example, LABEL_FALSE_REJECT, wavFile.getName());

        return new SaveResult(wavFile, metadataFile, LABEL_FALSE_REJECT);
    }

    static void clearPending() {
        synchronized (LOCK) {
            pendingExample = null;
        }
    }

    static CollectionStatus getStatus(Context context) {
        return new CollectionStatus(
            isCollectionEnabled(context),
            hasPendingExample(),
            countSavedFiles(context, LABEL_TRUE_ACCEPT),
            countSavedFiles(context, LABEL_FALSE_ACCEPT),
            countSavedFiles(context, LABEL_FALSE_REJECT)
        );
    }

    static String getStoragePath(Context context) {
        return baseDirectory(context).getAbsolutePath();
    }

    static short[] toPcm16(float[] input) {
        if (input == null) {
            return new short[0];
        }

        short[] output = new short[input.length];

        for (int index = 0; index < input.length; index += 1) {
            float clamped = Math.max(-1f, Math.min(1f, input[index]));
            output[index] = (short) Math.round(clamped * Short.MAX_VALUE);
        }

        return output;
    }

    static float estimateNoiseLevelRms(float[] input, int sampleRate) {
        if (input == null || input.length == 0 || sampleRate <= 0) {
            return 0f;
        }

        int windowSamples = Math.max(1, (sampleRate * NOISE_WINDOW_MS) / 1_000);
        float minRms = Float.MAX_VALUE;

        for (int start = 0; start < input.length; start += windowSamples) {
            int endExclusive = Math.min(input.length, start + windowSamples);
            minRms = Math.min(minRms, rootMeanSquare(input, start, endExclusive));
        }

        return minRms == Float.MAX_VALUE ? 0f : minRms;
    }

    static float estimateNoiseLevelRms(short[] input, int sampleRate) {
        if (input == null || input.length == 0 || sampleRate <= 0) {
            return 0f;
        }

        int windowSamples = Math.max(1, (sampleRate * NOISE_WINDOW_MS) / 1_000);
        float minRms = Float.MAX_VALUE;

        for (int start = 0; start < input.length; start += windowSamples) {
            int endExclusive = Math.min(input.length, start + windowSamples);
            minRms = Math.min(minRms, rootMeanSquare(input, start, endExclusive));
        }

        return minRms == Float.MAX_VALUE ? 0f : minRms;
    }

    private static File baseDirectory(Context context) {
        File root = context.getExternalFilesDir(null);

        if (root == null) {
            root = context.getFilesDir();
        }

        return new File(root, RELATIVE_STORAGE_PATH);
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE);
    }

    private static String normalizeLabel(String label) {
        if (LABEL_FALSE_ACCEPT.equals(label)) {
            return LABEL_FALSE_ACCEPT;
        }

        if (LABEL_FALSE_REJECT.equals(label)) {
            return LABEL_FALSE_REJECT;
        }

        return LABEL_TRUE_ACCEPT;
    }

    private static String buildBaseName(PendingWakeWordExample example, String label) {
        return String.format(
            Locale.ROOT,
            "%d_%s_score_%03d",
            example.detectedAtEpochMillis,
            label,
            Math.round(example.score * 1_000f)
        );
    }

    private static void writeMetadata(File metadataFile, PendingWakeWordExample example, String label, String audioFileName)
        throws IOException {
        WakeWordDiagnosticsSnapshot snapshot = WakeWordDiagnostics.snapshot();
        String json = "{\n" +
            "  \"label\": \"" + escapeJson(label) + "\",\n" +
            "  \"audioFile\": \"" + escapeJson(audioFileName) + "\",\n" +
            "  \"phraseId\": \"" + escapeJson(example.phraseId) + "\",\n" +
            "  \"displayPhrase\": \"" + escapeJson(example.displayPhrase) + "\",\n" +
            "  \"detectedAtEpochMillis\": " + example.detectedAtEpochMillis + ",\n" +
            "  \"score\": " + formatFloat(example.score) + ",\n" +
            "  \"threshold\": " + formatFloat(snapshot.threshold) + ",\n" +
            "  \"noiseLevelRms\": " + formatFloat(example.noiseLevelRms) + ",\n" +
            "  \"noiseLevelDbfs\": " + formatFloat(toDbfs(example.noiseLevelRms)) + ",\n" +
            "  \"sampleRate\": " + example.sampleRate + ",\n" +
            "  \"durationMs\": " + Math.round((example.samples.length * 1_000f) / example.sampleRate) + ",\n" +
            "  \"modelVersion\": \"" + escapeJson(snapshot.modelVersion) + "\",\n" +
            "  \"deviceModel\": \"" + escapeJson(deviceModel()) + "\",\n" +
            "  \"androidSdk\": " + Build.VERSION.SDK_INT + "\n" +
            "}\n";

        try (FileOutputStream output = new FileOutputStream(metadataFile)) {
            output.write(json.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static int countSavedFiles(Context context, String label) {
        File directory = new File(baseDirectory(context), label);
        File[] files = directory.listFiles((dir, name) -> name.endsWith(".wav"));

        return files == null ? 0 : files.length;
    }

    private static float rootMeanSquare(float[] input, int start, int endExclusive) {
        float sum = 0f;
        int count = Math.max(0, endExclusive - start);

        if (count == 0) {
            return 0f;
        }

        for (int index = start; index < endExclusive; index += 1) {
            sum += input[index] * input[index];
        }

        return (float) Math.sqrt(sum / count);
    }

    private static float rootMeanSquare(short[] input, int start, int endExclusive) {
        float sum = 0f;
        int count = Math.max(0, endExclusive - start);

        if (count == 0) {
            return 0f;
        }

        for (int index = start; index < endExclusive; index += 1) {
            float sample = input[index] / (float) Short.MAX_VALUE;
            sum += sample * sample;
        }

        return (float) Math.sqrt(sum / count);
    }

    private static float toDbfs(float rms) {
        if (rms <= 0f) {
            return -120f;
        }

        return 20f * (float) Math.log10(rms);
    }

    private static String formatFloat(float value) {
        return String.format(Locale.ROOT, "%.6f", value);
    }

    private static String deviceModel() {
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        String model = Build.MODEL == null ? "" : Build.MODEL.trim();
        String value = (manufacturer + " " + model).trim();

        return value.isEmpty() ? "unknown" : value;
    }

    private static String escapeJson(String value) {
        if (value == null) {
            return "";
        }

        return value
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "\\r");
    }

    static final class CollectionStatus {

        final boolean isEnabled;
        final boolean hasPendingExample;
        final int trueAcceptCount;
        final int falseAcceptCount;
        final int falseRejectCount;

        CollectionStatus(
            boolean isEnabled,
            boolean hasPendingExample,
            int trueAcceptCount,
            int falseAcceptCount,
            int falseRejectCount
        ) {
            this.isEnabled = isEnabled;
            this.hasPendingExample = hasPendingExample;
            this.trueAcceptCount = trueAcceptCount;
            this.falseAcceptCount = falseAcceptCount;
            this.falseRejectCount = falseRejectCount;
        }
    }

    static final class PendingSummary {

        final boolean hasPendingExample;
        final float score;
        final float noiseLevelRms;
        final int sampleRate;
        final int sampleCount;

        PendingSummary(boolean hasPendingExample, float score, float noiseLevelRms, int sampleRate, int sampleCount) {
            this.hasPendingExample = hasPendingExample;
            this.score = score;
            this.noiseLevelRms = noiseLevelRms;
            this.sampleRate = sampleRate;
            this.sampleCount = sampleCount;
        }
    }

    static final class SaveResult {

        final File audioFile;
        final File metadataFile;
        final String label;

        SaveResult(File audioFile, File metadataFile, String label) {
            this.audioFile = audioFile;
            this.metadataFile = metadataFile;
            this.label = label;
        }
    }

    private static final class PendingWakeWordExample {

        final long detectedAtEpochMillis;
        final String phraseId;
        final String displayPhrase;
        final float score;
        final float noiseLevelRms;
        final int sampleRate;
        final short[] samples;

        PendingWakeWordExample(
            long detectedAtEpochMillis,
            String phraseId,
            String displayPhrase,
            float score,
            float noiseLevelRms,
            int sampleRate,
            short[] samples
        ) {
            this.detectedAtEpochMillis = detectedAtEpochMillis;
            this.phraseId = phraseId;
            this.displayPhrase = displayPhrase;
            this.score = score;
            this.noiseLevelRms = noiseLevelRms;
            this.sampleRate = sampleRate;
            this.samples = samples.clone();
        }
    }
}
