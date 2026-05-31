package ru.chaotika.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import ai.onnxruntime.OnnxJavaType;
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
        WakeWordConfig config = WakeWordConfig.haotikaForProvider(WakeWordProvider.CUSTOM_TFLITE);
        CustomTfliteWakeWordEngine engine = new CustomTfliteWakeWordEngine(
            config,
            new FakeWakeWordAssetSource(true, false, 0.73f, WakeWordProvider.CUSTOM_TFLITE),
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
    public void customOnnxWakeWordEngine_returnsMissingModelWhenModelAssetIsAbsent() {
        WakeWordConfig config = WakeWordConfig.haotikaForProvider(WakeWordProvider.CUSTOM_ONNX);
        CustomOnnxWakeWordEngine engine = new CustomOnnxWakeWordEngine(
            config,
            FakeWakeWordAssetSource.rawPcmOnnx(true, false, 0.65f),
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
    public void customOnnxWakeWordEngine_rejectsLiveKitEmbeddingClassifierOutsideLiveKitEngine() {
        WakeWordConfig config = WakeWordConfig.haotikaForProvider(WakeWordProvider.CUSTOM_ONNX);
        CustomOnnxWakeWordEngine engine = new CustomOnnxWakeWordEngine(
            config,
            FakeWakeWordAssetSource.liveKitOnnx(true, true, 0.65f),
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

        assertEquals(WakeWordError.Code.UNSUPPORTED_MODEL_INPUT, errorRef.get().code);
        assertFalse(engine.isRunning());
    }

    @Test
    public void wakeWordEngineFactory_createsOnnxEngineForOnnxProvider() {
        WakeWordEngine engine = WakeWordEngineFactory.create(
            null,
            WakeWordConfig.haotikaForProvider(WakeWordProvider.CUSTOM_ONNX),
            FakeWakeWordAssetSource.rawPcmOnnx(true, false, 0.65f),
            new WakeWordMetricsLogger()
        );

        assertTrue(engine instanceof CustomOnnxWakeWordEngine);
    }

    @Test
    public void wakeWordEngineFactory_createsLiveKitEngineForLiveKitOnnxProvider() {
        WakeWordEngine engine = WakeWordEngineFactory.create(
            null,
            WakeWordConfig.haotikaForProvider(WakeWordProvider.CUSTOM_ONNX),
            FakeWakeWordAssetSource.liveKitOnnx(true, false, false, false, 0.65f),
            new WakeWordMetricsLogger()
        );

        assertTrue(engine instanceof LiveKitOnnxWakeWordEngine);
    }

    @Test
    public void liveKitOnnxWakeWordEngine_returnsMissingFrontendModelWhenMelModelIsAbsent() {
        WakeWordEngine engine = WakeWordEngineFactory.create(
            null,
            WakeWordConfig.haotikaForProvider(WakeWordProvider.CUSTOM_ONNX),
            FakeWakeWordAssetSource.liveKitOnnx(true, false, true, true, 0.65f),
            new WakeWordMetricsLogger()
        );

        assertEquals(WakeWordError.Code.MISSING_FRONTEND_MODEL, startAndCaptureError(engine).code);
    }

    @Test
    public void liveKitOnnxWakeWordEngine_returnsMissingFrontendModelWhenEmbeddingModelIsAbsent() {
        WakeWordEngine engine = WakeWordEngineFactory.create(
            null,
            WakeWordConfig.haotikaForProvider(WakeWordProvider.CUSTOM_ONNX),
            FakeWakeWordAssetSource.liveKitOnnx(true, true, false, true, 0.65f),
            new WakeWordMetricsLogger()
        );

        assertEquals(WakeWordError.Code.MISSING_FRONTEND_MODEL, startAndCaptureError(engine).code);
    }

    @Test
    public void liveKitOnnxWakeWordEngine_returnsMissingModelWhenClassifierIsAbsent() {
        WakeWordEngine engine = WakeWordEngineFactory.create(
            null,
            WakeWordConfig.haotikaForProvider(WakeWordProvider.CUSTOM_ONNX),
            FakeWakeWordAssetSource.liveKitOnnx(true, true, true, false, 0.65f),
            new WakeWordMetricsLogger()
        );

        assertEquals(WakeWordError.Code.MISSING_MODEL, startAndCaptureError(engine).code);
    }

    @Test
    public void wakeWordEngineFactory_rejectsUnsupportedOnnxFrontendCombination() {
        WakeWordEngine engine = WakeWordEngineFactory.create(
            null,
            WakeWordConfig.haotikaForProvider(WakeWordProvider.CUSTOM_ONNX),
            FakeWakeWordAssetSource.unsupportedOnnxFrontend(true, true, 0.65f),
            new WakeWordMetricsLogger()
        );

        assertTrue(engine instanceof UnavailableWakeWordEngine);
        assertEquals(WakeWordError.Code.UNSUPPORTED_MODEL_INPUT, startAndCaptureError(engine).code);
    }

    @Test
    public void liveKitOnnxRunnersReportModelIoMismatch() {
        try {
            WakeWordClassifierOnnxRunner.validateInputContract(
                "raw_audio",
                new long[] { 1L, 32_000L },
                OnnxJavaType.FLOAT,
                16,
                96
            );
        } catch (WakeWordError error) {
            assertEquals(WakeWordError.Code.MODEL_IO_MISMATCH, error.code);
            return;
        }

        throw new AssertionError("Expected model IO mismatch.");
    }

    @Test
    public void liveKitClassifierRunnerValidatesOutputNameShapeAndType() {
        try {
            WakeWordClassifierOnnxRunner.validateOutputContract("probability", new long[] { 1L, 1L }, OnnxJavaType.FLOAT);
        } catch (WakeWordError error) {
            assertEquals(WakeWordError.Code.MODEL_IO_MISMATCH, error.code);
            return;
        }

        throw new AssertionError("Expected model IO mismatch.");
    }

    @Test
    public void liveKitFrontendRunnersValidateAxisOrderAndOutputShape() {
        try {
            MelSpectrogramOnnxRunner.validateOutputContract("mel", new long[] { 1L, 32L, 76L }, OnnxJavaType.FLOAT);
        } catch (WakeWordError error) {
            assertEquals(WakeWordError.Code.MODEL_IO_MISMATCH, error.code);
            return;
        }

        throw new AssertionError("Expected mel model IO mismatch.");
    }

    @Test
    public void liveKitEmbeddingRunnerValidatesOutputShapeAndType() {
        try {
            EmbeddingModelOnnxRunner.validateOutputContract(new long[] { 1L, 96L, 1L, 1L }, OnnxJavaType.FLOAT);
        } catch (WakeWordError error) {
            assertEquals(WakeWordError.Code.MODEL_IO_MISMATCH, error.code);
            return;
        }

        throw new AssertionError("Expected embedding model IO mismatch.");
    }

    @Test
    public void rollingEmbeddingBufferKeepsLatestEmbeddingsInChronologicalOrder() throws Exception {
        RollingEmbeddingBuffer buffer = new RollingEmbeddingBuffer(3, 1);

        buffer.append(new float[] { 1f });
        buffer.append(new float[] { 2f });
        buffer.append(new float[] { 3f });
        buffer.append(new float[] { 4f });

        float[][] input = buffer.classifierInput();

        assertEquals(2f, input[0][0], 0.0001f);
        assertEquals(3f, input[1][0], 0.0001f);
        assertEquals(4f, input[2][0], 0.0001f);
    }

    @Test
    public void liveKitOfflineScorerNormalizesToLatestTwoSecondWindow() {
        float[] samples = new float[32_003];
        samples[0] = 0.1f;
        samples[3] = 0.2f;
        samples[32_002] = 0.9f;

        float[] window = LiveKitOnnxOfflineScorer.normalizeParityWindow(samples, 16_000);

        assertEquals(32_000, window.length);
        assertEquals(0.2f, window[0], 0.0001f);
        assertEquals(0.9f, window[31_999], 0.0001f);
    }

    @Test
    public void liveKitOfflineScorerPadsShortParityWindow() {
        float[] samples = new float[] { 0.3f, -0.4f };

        float[] window = LiveKitOnnxOfflineScorer.normalizeParityWindow(samples, 16_000);

        assertEquals(32_000, window.length);
        assertEquals(0f, window[0], 0.0001f);
        assertEquals(0.3f, window[31_998], 0.0001f);
        assertEquals(-0.4f, window[31_999], 0.0001f);
    }

    @Test
    public void liveKitOfflineScorerReturnsMissingFrontendModelBeforeInference() throws Exception {
        FakeWakeWordAssetSource source = FakeWakeWordAssetSource.liveKitOnnx(true, false, true, true, 0.65f);
        WakeWordModelManifest manifest = WakeWordModelManifest.read(
            source,
            WakeWordConfig.haotikaForProvider(WakeWordProvider.CUSTOM_ONNX)
        );

        try {
            LiveKitOnnxOfflineScorer.score(manifest, source, new float[32_000]);
        } catch (WakeWordError error) {
            assertEquals(WakeWordError.Code.MISSING_FRONTEND_MODEL, error.code);
            return;
        }

        throw new AssertionError("Expected missing frontend model.");
    }

    @Test
    public void liveKitOfflineScorerReturnsMissingClassifierBeforeInference() throws Exception {
        FakeWakeWordAssetSource source = FakeWakeWordAssetSource.liveKitOnnx(true, true, true, false, 0.65f);
        WakeWordModelManifest manifest = WakeWordModelManifest.read(
            source,
            WakeWordConfig.haotikaForProvider(WakeWordProvider.CUSTOM_ONNX)
        );

        try {
            LiveKitOnnxOfflineScorer.score(manifest, source, new float[32_000]);
        } catch (WakeWordError error) {
            assertEquals(WakeWordError.Code.MISSING_MODEL, error.code);
            return;
        }

        throw new AssertionError("Expected missing classifier model.");
    }

    @Test
    public void wakeWordEngineFactory_keepsTfliteAndMockProvidersAvailable() {
        WakeWordEngine tfliteEngine = WakeWordEngineFactory.create(
            null,
            WakeWordConfig.haotikaForProvider(WakeWordProvider.CUSTOM_TFLITE),
            new FakeWakeWordAssetSource(true, false, 0.99f, WakeWordProvider.CUSTOM_TFLITE),
            new WakeWordMetricsLogger()
        );
        WakeWordEngine mockEngine = WakeWordEngineFactory.create(
            null,
            WakeWordConfig.haotikaForProvider(WakeWordProvider.MOCK),
            new FakeWakeWordAssetSource(true, false, 0.65f, WakeWordProvider.MOCK),
            new WakeWordMetricsLogger()
        );

        assertTrue(tfliteEngine instanceof CustomTfliteWakeWordEngine);
        assertTrue(mockEngine instanceof MockWakeWordEngine);
    }

    @Test
    public void wakeWordModelManifest_usesManifestThreshold() throws Exception {
        WakeWordModelManifest manifest = WakeWordModelManifest.read(
            new FakeWakeWordAssetSource(true, true, 0.73f),
            WakeWordConfig.haotika()
        );

        assertEquals(0.73f, manifest.threshold, 0.0001f);
    }

    @Test
    public void wakeWordModelManifest_parsesCustomOnnxProviderAndRuntime() throws Exception {
        WakeWordModelManifest manifest = WakeWordModelManifest.read(
            new FakeWakeWordAssetSource(true, true, 0.65f, WakeWordProvider.CUSTOM_ONNX),
            WakeWordConfig.haotika()
        );

        assertEquals(WakeWordProvider.CUSTOM_ONNX, manifest.provider);
        assertEquals(WakeWordConfig.HAOTIKA_ONNX_MODEL_PATH, manifest.modelPath);
        assertEquals("haotika-livekit-test", manifest.modelVersion);
        assertEquals(WakeWordModelInputKind.EMBEDDING_MATRIX, manifest.inputKind);
        assertEquals(WakeWordModelFrontend.LIVEKIT_OPENWAKEWORD, manifest.frontend);
        assertFalse(manifest.ioContractConfirmedForAndroid);
        assertEquals(80, manifest.runtimeConfig.frameMs);
        assertEquals(1_280, manifest.runtimeConfig.windowMs);
        assertTrue(manifest.runtimeConfig.scoreSmoothing);
    }

    @Test
    public void wakeWordDiagnostics_exposesSafeModelVersionAndProvider() throws Exception {
        WakeWordModelManifest manifest = WakeWordModelManifest.read(
            new FakeWakeWordAssetSource(true, true, 0.65f, WakeWordProvider.CUSTOM_ONNX),
            WakeWordConfig.haotika()
        );

        WakeWordDiagnostics.updateModel(manifest.modelVersion, manifest.provider, manifest.threshold);

        WakeWordDiagnosticsSnapshot snapshot = WakeWordDiagnostics.snapshot();
        assertEquals("haotika-livekit-test", snapshot.modelVersion);
        assertEquals(WakeWordProvider.CUSTOM_ONNX, snapshot.provider);
        assertEquals(0.65f, snapshot.threshold, 0.0001f);
    }

    @Test
    public void wakeWordModelManifest_rejectsInvalidThreshold() {
        try {
            WakeWordModelManifest.read(new FakeWakeWordAssetSource(true, true, 1.2f), WakeWordConfig.haotika());
        } catch (WakeWordError error) {
            assertEquals(WakeWordError.Code.INVALID_MODEL_MANIFEST, error.code);
            return;
        }

        throw new AssertionError("Expected invalid manifest error.");
    }

    @Test
    public void customTfliteWakeWordEngine_normalizesModelInputLikeTraining() {
        float[] input = new float[] { 0.1f, -0.2f, 0f };

        float[] normalized = CustomTfliteWakeWordEngine.normalizeForModel(input);

        assertEquals(0.425f, normalized[0], 0.0001f);
        assertEquals(-0.85f, normalized[1], 0.0001f);
        assertEquals(0f, normalized[2], 0.0001f);
        assertEquals(0.1f, input[0], 0.0001f);
    }

    @Test
    public void customTfliteWakeWordEngine_capsNormalizationGainForQuietInput() {
        float[] normalized = CustomTfliteWakeWordEngine.normalizeForModel(new float[] { 0.02f, -0.04f });

        assertEquals(0.16f, normalized[0], 0.0001f);
        assertEquals(-0.32f, normalized[1], 0.0001f);
    }

    @Test
    public void customTfliteWakeWordEngine_runsModelForSustainedSpeechLikeAudio() {
        float[] input = new float[32_000];
        writeTone(input, 8_000, 12_800, 220.0, 0.08f);

        assertTrue(CustomTfliteWakeWordEngine.shouldRunModelForAudio(input));
    }

    @Test
    public void customTfliteWakeWordEngine_blocksShortNoiseBurstsBeforeModel() {
        float[] input = new float[32_000];
        for (int index = 10_000; index < 10_000 + 1_280; index += 1) {
            input[index] = 0.35f;
        }

        assertFalse(CustomTfliteWakeWordEngine.shouldRunModelForAudio(input));
    }

    @Test
    public void customTfliteWakeWordEngine_blocksHighFrequencyRustleBeforeModel() {
        float[] input = new float[32_000];
        for (int index = 8_000; index < 8_000 + 4_800; index += 1) {
            input[index] = index % 2 == 0 ? 0.12f : -0.12f;
        }

        assertFalse(CustomTfliteWakeWordEngine.shouldRunModelForAudio(input));
    }

    @Test
    public void customTfliteWakeWordEngine_preparesReviewSampleWithPostRoll() {
        float[] preDetection = new float[32_000];
        for (int index = 31_200; index < preDetection.length; index += 1) {
            preDetection[index] = 0.2f;
        }

        short[] postDetection = new short[12_800];
        for (int index = 0; index < 10_000; index += 1) {
            postDetection[index] = 6_000;
        }

        short[] reviewSample = CustomTfliteWakeWordEngine.prepareReviewSamples(preDetection, postDetection, 32_000);

        assertTrue(reviewSample.length > 10_000);
        assertTrue(reviewSample.length <= 32_000);
    }

    @Test
    public void customTfliteWakeWordEngine_fallsBackToLatestPcmWindow() {
        short[] latest = CustomTfliteWakeWordEngine.latestPcmWindow(new short[] { 1, 2, 3, 4 }, 2);

        assertEquals(3, latest[0]);
        assertEquals(4, latest[1]);
    }

    @Test
    public void voiceAssistantStateMachine_movesWakeListeningToWakeReview() {
        assertEquals(
            VoiceAssistantState.REVIEWING_WAKE_WORD,
            VoiceAssistantStateMachine.onWakeWordDetected(VoiceAssistantState.LISTENING_FOR_WAKE_WORD)
        );
    }

    @Test
    public void voiceAssistantStateMachine_blocksWakeListeningDuringReviewAndCommandCapture() {
        assertFalse(VoiceAssistantStateMachine.canStartWakeWordDetection(VoiceAssistantState.REVIEWING_WAKE_WORD));
        assertFalse(VoiceAssistantStateMachine.canStartWakeWordDetection(VoiceAssistantState.RECORDING_COMMAND));
        assertFalse(VoiceAssistantStateMachine.canStartWakeWordDetection(VoiceAssistantState.TRANSCRIBING));
        assertTrue(VoiceAssistantStateMachine.canStartWakeWordDetection(VoiceAssistantState.IDLE));
        assertTrue(VoiceAssistantStateMachine.canStartWakeWordDetection(VoiceAssistantState.WAITING_FOR_CONFIRMATION));
    }

    @Test
    public void trainingExampleStore_capturesPendingReviewSampleWithoutOptIn() {
        WakeWordTrainingExampleStore.clearPending();
        WakeWordDetection detection = new WakeWordDetection(
            "haotika",
            "Хаотика",
            0.8f,
            10L,
            new short[] { 100, 200, 300 },
            16_000,
            0.02f
        );

        WakeWordTrainingExampleStore.capturePendingForReview(detection);

        assertTrue(WakeWordTrainingExampleStore.hasPendingExample());
        WakeWordTrainingExampleStore.clearPending();
    }

    @Test
    public void trainingExampleStore_returnsEmptyPendingAudioWithoutSample() {
        WakeWordTrainingExampleStore.clearPending();

        WakeWordTrainingExampleStore.PendingAudio pendingAudio = WakeWordTrainingExampleStore.pendingAudio();

        assertFalse(pendingAudio.hasPendingExample);
        assertEquals(0, pendingAudio.sampleRate);
        assertEquals(0, pendingAudio.samples.length);
    }

    @Test
    public void trainingExampleStore_returnsDefensivePendingAudioCopy() {
        WakeWordTrainingExampleStore.clearPending();
        short[] samples = new short[] { 100, 200 };
        WakeWordDetection detection = new WakeWordDetection(
            "haotika",
            "Хаотика",
            0.8f,
            10L,
            samples,
            16_000,
            0.02f
        );

        WakeWordTrainingExampleStore.capturePendingForReview(detection);
        WakeWordTrainingExampleStore.PendingAudio pendingAudio = WakeWordTrainingExampleStore.pendingAudio();
        pendingAudio.samples[0] = 999;

        WakeWordTrainingExampleStore.PendingAudio rereadPendingAudio = WakeWordTrainingExampleStore.pendingAudio();

        assertTrue(rereadPendingAudio.hasPendingExample);
        assertEquals(16_000, rereadPendingAudio.sampleRate);
        assertEquals(100, rereadPendingAudio.samples[0]);
        assertEquals(200, rereadPendingAudio.samples[1]);
        WakeWordTrainingExampleStore.clearPending();
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

    private static void writeTone(float[] input, int offset, int length, double frequencyHz, float amplitude) {
        for (int index = 0; index < length; index += 1) {
            input[offset + index] = (float) Math.sin((2.0 * Math.PI * frequencyHz * index) / 16_000.0) * amplitude;
        }
    }

    private static WakeWordError startAndCaptureError(WakeWordEngine engine) {
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

        if (errorRef.get() == null) {
            throw new AssertionError("Expected wake-word engine error.");
        }

        return errorRef.get();
    }

    private static final class FakeWakeWordAssetSource implements WakeWordAssetSource {

        private static final byte[] FAKE_MODEL_BYTES = new byte[] { 1, 2, 3, 4 };

        private final boolean hasClassifierModel;
        private final boolean hasEmbeddingModel;
        private final boolean hasManifest;
        private final boolean hasMelModel;
        private final WakeWordModelFrontend frontend;
        private final WakeWordModelInputKind inputKind;
        private final boolean ioContractConfirmedForAndroid;
        private final WakeWordProvider provider;
        private final float threshold;

        private FakeWakeWordAssetSource(boolean hasManifest, boolean hasModel) {
            this(hasManifest, hasModel, WakeWordConfig.HAOTIKA_THRESHOLD);
        }

        private FakeWakeWordAssetSource(boolean hasManifest, boolean hasModel, float threshold) {
            this(hasManifest, hasModel, threshold, WakeWordProvider.CUSTOM_ONNX);
        }

        private FakeWakeWordAssetSource(
            boolean hasManifest,
            boolean hasModel,
            float threshold,
            WakeWordProvider provider
        ) {
            this(
                hasManifest,
                hasModel,
                threshold,
                provider,
                provider == WakeWordProvider.CUSTOM_ONNX ? WakeWordModelInputKind.EMBEDDING_MATRIX : WakeWordModelInputKind.RAW_PCM,
                provider == WakeWordProvider.CUSTOM_ONNX ? WakeWordModelFrontend.LIVEKIT_OPENWAKEWORD : WakeWordModelFrontend.NONE,
                false
            );
        }

        private FakeWakeWordAssetSource(
            boolean hasManifest,
            boolean hasModel,
            float threshold,
            WakeWordProvider provider,
            WakeWordModelInputKind inputKind,
            WakeWordModelFrontend frontend,
            boolean ioContractConfirmedForAndroid
        ) {
            this.hasManifest = hasManifest;
            this.hasMelModel = provider == WakeWordProvider.CUSTOM_ONNX &&
                inputKind == WakeWordModelInputKind.EMBEDDING_MATRIX &&
                hasModel;
            this.hasEmbeddingModel = provider == WakeWordProvider.CUSTOM_ONNX &&
                inputKind == WakeWordModelInputKind.EMBEDDING_MATRIX &&
                hasModel;
            this.hasClassifierModel = hasModel;
            this.threshold = threshold;
            this.provider = provider;
            this.inputKind = inputKind;
            this.frontend = frontend;
            this.ioContractConfirmedForAndroid = ioContractConfirmedForAndroid;
        }

        static FakeWakeWordAssetSource rawPcmOnnx(boolean hasManifest, boolean hasModel, float threshold) {
            return new FakeWakeWordAssetSource(
                hasManifest,
                hasModel,
                threshold,
                WakeWordProvider.CUSTOM_ONNX,
                WakeWordModelInputKind.RAW_PCM,
                WakeWordModelFrontend.NONE,
                true
            );
        }

        static FakeWakeWordAssetSource liveKitOnnx(boolean hasManifest, boolean hasModel, float threshold) {
            return liveKitOnnx(hasManifest, hasModel, hasModel, hasModel, threshold);
        }

        static FakeWakeWordAssetSource liveKitOnnx(
            boolean hasManifest,
            boolean hasMelModel,
            boolean hasEmbeddingModel,
            boolean hasClassifierModel,
            float threshold
        ) {
            FakeWakeWordAssetSource source = new FakeWakeWordAssetSource(
                hasManifest,
                hasClassifierModel,
                threshold,
                WakeWordProvider.CUSTOM_ONNX,
                WakeWordModelInputKind.EMBEDDING_MATRIX,
                WakeWordModelFrontend.LIVEKIT_OPENWAKEWORD,
                false
            );
            source.hasMelModelOverride = hasMelModel;
            source.hasEmbeddingModelOverride = hasEmbeddingModel;
            return source;
        }

        static FakeWakeWordAssetSource unsupportedOnnxFrontend(boolean hasManifest, boolean hasModel, float threshold) {
            return new FakeWakeWordAssetSource(
                hasManifest,
                hasModel,
                threshold,
                WakeWordProvider.CUSTOM_ONNX,
                WakeWordModelInputKind.EMBEDDING_MATRIX,
                WakeWordModelFrontend.NONE,
                false
            );
        }

        private Boolean hasEmbeddingModelOverride;
        private Boolean hasMelModelOverride;

        @Override
        public boolean exists(String path) {
            if (WakeWordConfig.HAOTIKA_MANIFEST_PATH.equals(path)) {
                return hasManifest;
            }

            if (WakeWordConfig.HAOTIKA_LIVEKIT_MELSPECTROGRAM_MODEL_PATH.equals(path)) {
                return hasMelModelOverride == null ? hasMelModel : hasMelModelOverride;
            }

            if (WakeWordConfig.HAOTIKA_LIVEKIT_EMBEDDING_MODEL_PATH.equals(path)) {
                return hasEmbeddingModelOverride == null ? hasEmbeddingModel : hasEmbeddingModelOverride;
            }

            if (modelPath().equals(path)) {
                return hasClassifierModel;
            }

            return false;
        }

        @Override
        public byte[] read(String path) throws IOException {
            if (!exists(path)) {
                throw new IOException("Missing fake asset: " + path);
            }

            if (!WakeWordConfig.HAOTIKA_MANIFEST_PATH.equals(path)) {
                return FAKE_MODEL_BYTES;
            }

            return (
                "{"
                    + "\"phraseId\":\"haotika\","
                    + "\"displayPhrase\":\"Хаотика\","
                    + "\"language\":\"ru-RU\","
                    + "\"modelVersion\":\"haotika-livekit-test\","
                    + "\"provider\":\"" + provider.manifestValue + "\","
                    + "\"modelPath\":\"" + modelPath() + "\","
                    + "\"inputKind\":\"" + inputKind.manifestValue + "\","
                    + "\"frontend\":\"" + frontend.manifestValue + "\","
                    + "\"ioContractConfirmedForAndroid\":" + ioContractConfirmedForAndroid + ","
                    + "\"models\":{"
                    + "\"melspectrogram\":\"" + WakeWordConfig.HAOTIKA_LIVEKIT_MELSPECTROGRAM_MODEL_PATH + "\","
                    + "\"embedding\":\"" + WakeWordConfig.HAOTIKA_LIVEKIT_EMBEDDING_MODEL_PATH + "\","
                    + "\"classifier\":\"" + modelPath() + "\""
                    + "},"
                    + "\"frontendConfig\":{\"embeddingWindowSize\":16,\"embeddingSize\":96},"
                    + "\"threshold\":" + threshold + ","
                    + "\"sampleRate\":16000,"
                    + "\"vadEnabled\":true,"
                    + "\"runtime\":{\"frameMs\":80,\"windowMs\":1280,\"scoreSmoothing\":true}"
                    + "}"
            ).getBytes(StandardCharsets.UTF_8);
        }

        private String modelPath() {
            return provider == WakeWordProvider.CUSTOM_TFLITE
                ? WakeWordConfig.HAOTIKA_TFLITE_MODEL_PATH
                : WakeWordConfig.HAOTIKA_ONNX_MODEL_PATH;
        }
    }
}
