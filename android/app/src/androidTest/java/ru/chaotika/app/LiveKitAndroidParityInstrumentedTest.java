package ru.chaotika.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assume.assumeTrue;

import android.content.Context;
import android.content.res.AssetManager;
import android.os.Bundle;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class LiveKitAndroidParityInstrumentedTest {

    private static final String EXPECTED_DIR = "wakeword-parity/expected";
    private static final String INPUT_DIR = "wakeword-parity/input";
    private static final String PARITY_ARG = "wakewordParity";
    private static final String PARITY_CONFIG = "wakeword-parity/parity.config.json";

    @Test
    public void liveKitAndroidScoresMatchPythonFixturesWhenEnabled() throws Exception {
        Bundle arguments = InstrumentationRegistry.getArguments();
        boolean enabled = "true".equals(arguments.getString(PARITY_ARG));
        assumeTrue(
            "LiveKit parity is opt-in. Copy local ONNX/WAV/expected fixtures, then run connectedDebugAndroidTest with wakewordParity=true.",
            enabled
        );

        Context targetContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        AssetManager testAssets = InstrumentationRegistry.getInstrumentation().getContext().getAssets();
        String[] fixtureNames = testAssets.list(INPUT_DIR);
        assertTrue("No parity WAV fixtures found in androidTest assets: " + INPUT_DIR, fixtureNames != null && fixtureNames.length > 0);

        AndroidWakeWordAssetSource wakeWordAssets = new AndroidWakeWordAssetSource(targetContext);
        WakeWordConfig config = WakeWordConfig.haotikaForProvider(WakeWordProvider.CUSTOM_ONNX);
        WakeWordModelManifest manifest = WakeWordModelManifest.read(wakeWordAssets, config);
        Tolerance tolerance = readTolerance(testAssets);
        int checked = 0;

        for (String fixtureName : fixtureNames) {
            if (!fixtureName.endsWith(".wav")) {
                continue;
            }

            String stem = fixtureName.substring(0, fixtureName.length() - ".wav".length());
            JSONObject expected = readJson(testAssets, EXPECTED_DIR + "/" + stem + "_score.json");
            float[] samples = LiveKitOnnxOfflineScorer.normalizeParityWindow(readPcm16Wav(testAssets, INPUT_DIR + "/" + fixtureName), 16_000);
            LiveKitOnnxOfflineScorer.Result actual = LiveKitOnnxOfflineScorer.score(manifest, wakeWordAssets, samples);

            assertExpectedClassifierContract(expected);
            assertEquals(
                "Python/Android score mismatch for " + fixtureName,
                expected.getDouble("score"),
                actual.score,
                tolerance.scoreTolerance
            );
            assertEquals("Classifier window size mismatch for " + fixtureName, 16, actual.classifierWindowSize);
            assertEquals("Classifier embedding size mismatch for " + fixtureName, 96, actual.classifierEmbeddingSize);
            assertTrue("Android generated too few embeddings for " + fixtureName, actual.generatedEmbeddingCount >= 16);
            assertEquals("Generated embedding size mismatch for " + fixtureName, 96, actual.generatedEmbeddingSize);
            assertExpectedEmbeddingShape(expected, actual, fixtureName);
            assertExpectedDetectionSemantics(stem, expected.getDouble("score"), actual.score, manifest.threshold, tolerance.scoreTolerance);
            checked += 1;
        }

        assertTrue("No .wav parity fixtures found in androidTest assets: " + INPUT_DIR, checked > 0);
    }

    private static void assertExpectedClassifierContract(JSONObject expected) throws Exception {
        JSONObject classifierIo = expected.getJSONObject("classifierIo");
        JSONArray inputs = classifierIo.getJSONArray("inputs");
        JSONArray outputs = classifierIo.getJSONArray("outputs");
        JSONObject input = inputs.getJSONObject(0);
        JSONObject output = outputs.getJSONObject(0);

        assertEquals("embeddings", input.getString("name"));
        assertEquals("tensor(float)", input.getString("type"));
        assertEquals("score", output.getString("name"));
        assertEquals("tensor(float)", output.getString("type"));
    }

    private static void assertExpectedEmbeddingShape(
        JSONObject expected,
        LiveKitOnnxOfflineScorer.Result actual,
        String fixtureName
    ) throws Exception {
        JSONArray embeddingShape = expected.getJSONArray("embeddingShape");

        assertEquals("Expected embedding shape rank mismatch for " + fixtureName, 2, embeddingShape.length());
        assertEquals("Expected embedding window mismatch for " + fixtureName, 16, embeddingShape.getInt(0));
        assertEquals("Expected embedding size mismatch for " + fixtureName, 96, embeddingShape.getInt(1));
        assertEquals("Android classifier window mismatch for " + fixtureName, embeddingShape.getInt(0), actual.classifierWindowSize);
        assertEquals("Android classifier embedding size mismatch for " + fixtureName, embeddingShape.getInt(1), actual.classifierEmbeddingSize);
        assertEquals("Expected audio window mismatch for " + fixtureName, 32_000, expected.getInt("audioWindowSamples"));
    }

    private static void assertExpectedDetectionSemantics(
        String stem,
        double expectedScore,
        float actualScore,
        float threshold,
        float scoreTolerance
    ) {
        if (stem.contains("haotika")) {
            assertTrue("Positive parity fixture should reach threshold: " + stem, actualScore >= threshold);
        }

        if (stem.contains("negative") || stem.contains("kotika") || stem.contains("silence") || stem.contains("noise")) {
            if (expectedScore < threshold) {
                assertTrue(
                    "Negative/noise parity fixture should stay below threshold: " + stem,
                    actualScore < threshold + scoreTolerance
                );
            }
        }
    }

    private static JSONObject readJson(AssetManager assets, String path) throws Exception {
        return new JSONObject(new String(readAssetBytes(assets, path), StandardCharsets.UTF_8));
    }

    private static Tolerance readTolerance(AssetManager assets) {
        try {
            JSONObject value = readJson(assets, PARITY_CONFIG);
            return new Tolerance((float) value.optDouble("scoreTolerance", Tolerance.DEFAULT_SCORE_TOLERANCE));
        } catch (Exception ignored) {
            return new Tolerance(Tolerance.DEFAULT_SCORE_TOLERANCE);
        }
    }

    private static float[] readPcm16Wav(AssetManager assets, String path) throws IOException {
        byte[] bytes = readAssetBytes(assets, path);
        requireAscii(bytes, 0, "RIFF", path);
        requireAscii(bytes, 8, "WAVE", path);

        int offset = 12;
        int channels = -1;
        int sampleRate = -1;
        int bitsPerSample = -1;
        int audioFormat = -1;
        int dataOffset = -1;
        int dataSize = -1;

        while (offset + 8 <= bytes.length) {
            String chunkId = ascii(bytes, offset, 4);
            int chunkSize = littleEndianInt(bytes, offset + 4);
            int chunkDataOffset = offset + 8;

            if ("fmt ".equals(chunkId)) {
                audioFormat = littleEndianShort(bytes, chunkDataOffset);
                channels = littleEndianShort(bytes, chunkDataOffset + 2);
                sampleRate = littleEndianInt(bytes, chunkDataOffset + 4);
                bitsPerSample = littleEndianShort(bytes, chunkDataOffset + 14);
            } else if ("data".equals(chunkId)) {
                dataOffset = chunkDataOffset;
                dataSize = chunkSize;
            }

            offset = chunkDataOffset + chunkSize + (chunkSize % 2);
        }

        assertEquals("WAV must be PCM16: " + path, 1, audioFormat);
        assertEquals("WAV must be mono: " + path, 1, channels);
        assertEquals("WAV must be 16 kHz: " + path, 16_000, sampleRate);
        assertEquals("WAV must be 16-bit: " + path, 16, bitsPerSample);
        assertTrue("WAV data chunk is missing: " + path, dataOffset >= 0 && dataSize > 0);

        float[] samples = new float[dataSize / 2];
        for (int index = 0; index < samples.length; index += 1) {
            int sampleOffset = dataOffset + index * 2;
            short sample = (short) littleEndianShort(bytes, sampleOffset);
            samples[index] = sample / 32768f;
        }

        return samples;
    }

    private static byte[] readAssetBytes(AssetManager assets, String path) throws IOException {
        try (InputStream input = assets.open(path)) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8_192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static void requireAscii(byte[] bytes, int offset, String expected, String path) {
        assertEquals("Unexpected WAV header in " + path, expected, ascii(bytes, offset, expected.length()));
    }

    private static String ascii(byte[] bytes, int offset, int length) {
        return new String(bytes, offset, length, StandardCharsets.US_ASCII);
    }

    private static int littleEndianShort(byte[] bytes, int offset) {
        return (bytes[offset] & 0xff) | ((bytes[offset + 1] & 0xff) << 8);
    }

    private static int littleEndianInt(byte[] bytes, int offset) {
        return (bytes[offset] & 0xff) |
        ((bytes[offset + 1] & 0xff) << 8) |
        ((bytes[offset + 2] & 0xff) << 16) |
        ((bytes[offset + 3] & 0xff) << 24);
    }

    private static final class Tolerance {

        static final float DEFAULT_SCORE_TOLERANCE = 0.03f;

        final float scoreTolerance;

        Tolerance(float scoreTolerance) {
            this.scoreTolerance = scoreTolerance;
        }
    }
}
