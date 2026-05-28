package ru.chaotika.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;

public class WakeWordEngineTest {

    @Test
    public void mockWakeWordEngine_emitsDetectionAndPausesListening() {
        MockWakeWordEngine engine = new MockWakeWordEngine();
        AtomicInteger detectionCount = new AtomicInteger(0);

        engine.start(
            new WakeWordListener() {
                @Override
                public void onWakeWordDetected(WakeWordDetection detection) {
                    detectionCount.incrementAndGet();
                    assertEquals("haotika", detection.phraseId);
                    assertEquals("Хаотика", detection.displayPhrase);
                    assertEquals(1f, detection.score, 0.0001f);
                }

                @Override
                public void onScore(float score) {}

                @Override
                public void onError(WakeWordError error) {}
            }
        );

        assertTrue(engine.isRunning());
        engine.simulateWakeWord();

        assertEquals(1, detectionCount.get());
        assertFalse(engine.isRunning());
    }

    @Test
    public void wakeWordService_dependsOnWakeWordEngineInterface() throws Exception {
        Field field = WakeWordService.class.getDeclaredField("wakeWordEngine");

        assertEquals(WakeWordEngine.class, field.getType());
    }

    @Test
    public void customTfliteWakeWordEngine_returnsMissingModelWhenModelAssetIsAbsent() {
        WakeWordConfig config = WakeWordConfig.haotika();
        CustomTfliteWakeWordEngine engine = new CustomTfliteWakeWordEngine(
            config,
            new FakeWakeWordAssetSource(true, false),
            new WakeWordMetricsLogger()
        );
        AtomicReference<WakeWordError> errorRef = new AtomicReference<>();

        engine.start(
            new WakeWordListener() {
                @Override
                public void onWakeWordDetected(WakeWordDetection detection) {}

                @Override
                public void onScore(float score) {}

                @Override
                public void onError(WakeWordError error) {
                    errorRef.set(error);
                }
            }
        );

        assertEquals(WakeWordError.Code.MISSING_MODEL, errorRef.get().code);
        assertFalse(engine.isRunning());
    }

    @Test
    public void voiceAssistantStateMachine_movesWakeListeningToWakeDetected() {
        assertEquals(
            VoiceAssistantState.WAKE_WORD_DETECTED,
            VoiceAssistantStateMachine.onWakeWordDetected(VoiceAssistantState.LISTENING_FOR_WAKE_WORD)
        );
    }

    @Test
    public void wakeWordDetection_defensivelyCopiesAudioSamples() {
        short[] samples = new short[] { 100, 200 };
        WakeWordDetection detection = new WakeWordDetection("haotika", "Хаотика", 0.7f, 10L, samples, 16_000, 0.01f);

        samples[0] = 999;

        assertTrue(detection.hasAudioSamples());
        assertEquals(100, detection.audioSamples[0]);
    }

    @Test
    public void trainingExampleStore_convertsFloatsToPcm16AndEstimatesNoise() {
        short[] pcm = WakeWordTrainingExampleStore.toPcm16(new float[] { -2f, -0.5f, 0f, 0.5f, 2f });
        float noise = WakeWordTrainingExampleStore.estimateNoiseLevelRms(new float[] { 0.01f, 0.01f, 0.2f, 0.2f }, 10);

        assertEquals(-32767, pcm[0]);
        assertEquals(-16383, pcm[1]);
        assertEquals(0, pcm[2]);
        assertEquals(16384, pcm[3]);
        assertEquals(32767, pcm[4]);
        assertEquals(0.01f, noise, 0.0001f);
    }

    private static final class FakeWakeWordAssetSource implements WakeWordAssetSource {

        private final boolean hasManifest;
        private final boolean hasModel;

        private FakeWakeWordAssetSource(boolean hasManifest, boolean hasModel) {
            this.hasManifest = hasManifest;
            this.hasModel = hasModel;
        }

        @Override
        public boolean exists(String path) {
            if (WakeWordConfig.HAOTIKA_MANIFEST_PATH.equals(path)) {
                return hasManifest;
            }

            if (WakeWordConfig.HAOTIKA_MODEL_PATH.equals(path)) {
                return hasModel;
            }

            return false;
        }

        @Override
        public byte[] read(String path) throws IOException {
            if (!exists(path)) {
                throw new IOException("Missing fake asset: " + path);
            }

            return (
                "{"
                    + "\"phraseId\":\"haotika\","
                    + "\"displayPhrase\":\"Хаотика\","
                    + "\"language\":\"ru-RU\","
                    + "\"modelPath\":\"wakewords/haotika.tflite\","
                    + "\"threshold\":0.65,"
                    + "\"sampleRate\":16000,"
                    + "\"vadEnabled\":true"
                    + "}"
            ).getBytes(StandardCharsets.UTF_8);
        }
    }
}
