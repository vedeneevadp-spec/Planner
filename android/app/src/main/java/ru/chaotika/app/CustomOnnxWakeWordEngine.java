package ru.chaotika.app;

import ai.onnxruntime.NodeInfo;
import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OnnxValue;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import ai.onnxruntime.OrtSession;
import ai.onnxruntime.TensorInfo;
import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

// This engine supports raw-PCM ONNX models only. LiveKit/openWakeWord
// classifiers expect a (batch, 16, 96) embedding matrix and must be routed
// through LiveKitOnnxWakeWordEngine, which owns the mel + embedding frontend.
final class CustomOnnxWakeWordEngine implements WakeWordEngine {

    private static final int DEFAULT_INFERENCE_STRIDE_SAMPLES = 1_280;
    private static final int MIN_RING_BUFFER_SECONDS = 2;
    private static final int TRAINING_SAMPLE_POST_ROLL_MS = 800;

    private final WakeWordAssetSource assets;
    private final WakeWordConfig config;
    private final Context context;
    private final Object lock = new Object();
    private final WakeWordMetricsLogger metricsLogger;

    private AudioRecord audioRecord;
    private Thread audioThread;
    private String inputName;
    private int inputRank;
    private InterpreterShape inputShape;
    private volatile boolean isRunning;
    private WakeWordListener listener;
    private OrtEnvironment ortEnvironment;
    private OrtSession ortSession;
    private float[] ringBuffer;
    private int ringSamplesAvailable;
    private int ringWriteIndex;
    private float smoothedScore;
    private volatile float threshold;
    private WakeWordModelManifest manifest;

    CustomOnnxWakeWordEngine(
        Context context,
        WakeWordConfig config,
        WakeWordAssetSource assets,
        WakeWordMetricsLogger metricsLogger
    ) {
        this.context = context == null ? null : context.getApplicationContext();
        this.config = config;
        this.assets = assets;
        this.metricsLogger = metricsLogger;
        this.threshold = config.threshold;
    }

    CustomOnnxWakeWordEngine(WakeWordConfig config, WakeWordAssetSource assets, WakeWordMetricsLogger metricsLogger) {
        this(null, config, assets, metricsLogger);
    }

    @Override
    public String getWakePhrase() {
        return config.displayPhrase;
    }

    @Override
    public WakeWordConfig getConfig() {
        return config;
    }

    @Override
    public boolean isRunning() {
        return isRunning;
    }

    @Override
    public CommandAudioPreBuffer latestCommandPreBuffer(int durationMs) {
        if (ringBuffer == null || ringSamplesAvailable <= 0 || durationMs <= 0) {
            return CommandAudioPreBuffer.empty(config.sampleRate);
        }

        int sampleCount = Math.min(
            ringSamplesAvailable,
            Math.max(1, (config.sampleRate * durationMs) / 1_000)
        );

        return CommandAudioPreBuffer.fromFloatSamples(latestSamples(sampleCount), config.sampleRate);
    }

    @Override
    public void start(WakeWordListener listener) {
        synchronized (lock) {
            if (isRunning) {
                return;
            }

            this.listener = listener;
        }

        try {
            manifest = WakeWordModelManifest.read(assets, config);
            if (manifest.provider != WakeWordProvider.CUSTOM_ONNX) {
                throw WakeWordError.unsupportedProvider(manifest.provider.manifestValue);
            }

            threshold = manifest.threshold;
            smoothedScore = 0f;
            WakeWordDiagnostics.updateModel(manifest.modelVersion, manifest.provider, threshold);
            ensureSupportedInputContract(manifest);

            if (!assets.exists(manifest.modelPath)) {
                throw WakeWordError.missingModel(manifest.modelPath);
            }

            ensureMicrophonePermission();
            createSession(assets.read(manifest.modelPath));
            metricsLogger.modelLoaded(manifest);
            startAudioCapture();
        } catch (WakeWordError error) {
            fail(error);
        } catch (Exception error) {
            fail(WakeWordError.modelLoadError(WakeWordProvider.CUSTOM_ONNX.metricValue, error));
        }
    }

    @Override
    public void stop() {
        Thread threadToJoin;

        synchronized (lock) {
            isRunning = false;
            listener = null;
            threadToJoin = audioThread;
            audioThread = null;
        }

        if (audioRecord != null) {
            try {
                audioRecord.stop();
            } catch (IllegalStateException ignored) {
                // AudioRecord may already be stopped if the capture thread failed.
            }

            audioRecord.release();
            audioRecord = null;
        }

        if (ortSession != null) {
            try {
                ortSession.close();
            } catch (OrtException ignored) {
                // The session is being torn down after an error path.
            }
            ortSession = null;
        }

        clearRingBuffer();

        if (threadToJoin != null && threadToJoin != Thread.currentThread()) {
            try {
                threadToJoin.join(700L);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private void createSession(byte[] modelBytes) throws OrtException, WakeWordError {
        ortEnvironment = OrtEnvironment.getEnvironment();

        try (OrtSession.SessionOptions options = OnnxWakeWordSessionOptions.create()) {
            ortSession = ortEnvironment.createSession(modelBytes, options);
        }

        Map.Entry<String, NodeInfo> input = ortSession.getInputInfo().entrySet().iterator().next();
        inputName = input.getKey();

        if (!(input.getValue().getInfo() instanceof TensorInfo tensorInfo)) {
            throw WakeWordError.modelLoadError(
                WakeWordProvider.CUSTOM_ONNX.metricValue,
                new IllegalStateException("ONNX wake-word input is not a tensor.")
            );
        }

        long[] shape = tensorInfo.getShape();
        if (looksLikeLiveKitEmbeddingClassifier(inputName, shape)) {
            throw WakeWordError.unsupportedModelInput(
                "LiveKit wake-word classifier ONNX expects embedding matrix input; use LiveKitOnnxWakeWordEngine."
            );
        }

        inputRank = shape.length;
        inputShape = InterpreterShape.from(shape, manifest.runtimeConfig, config.sampleRate);
    }

    private static void ensureSupportedInputContract(WakeWordModelManifest manifest) throws WakeWordError {
        if (manifest.inputKind == WakeWordModelInputKind.RAW_PCM && manifest.frontend == WakeWordModelFrontend.NONE) {
            return;
        }

        if (
            manifest.inputKind == WakeWordModelInputKind.EMBEDDING_MATRIX &&
            manifest.frontend == WakeWordModelFrontend.LIVEKIT_OPENWAKEWORD
        ) {
            throw WakeWordError.unsupportedModelInput(
                "LiveKit/openWakeWord embedding models must run through LiveKitOnnxWakeWordEngine."
            );
        }

        throw WakeWordError.unsupportedModelInput(
            "Unsupported ONNX wake-word input contract: inputKind=" +
            manifest.inputKind.manifestValue +
            ", frontend=" +
            manifest.frontend.manifestValue +
            "."
        );
    }

    private static boolean looksLikeLiveKitEmbeddingClassifier(String inputName, long[] shape) {
        return "embeddings".equals(inputName) ||
            (shape.length == 3 && isSingleOrDynamicDimension(shape[0]) && shape[1] == 16L && shape[2] == 96L);
    }

    private static boolean isSingleOrDynamicDimension(long dimension) {
        return dimension == 1L || dimension <= 0L;
    }

    private void ensureMicrophonePermission() throws WakeWordError {
        if (context == null) {
            return;
        }

        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            throw WakeWordError.microphonePermissionDenied();
        }
    }

    @SuppressLint("MissingPermission")
    private void startAudioCapture() throws WakeWordError {
        if (context == null) {
            throw WakeWordError.inferenceError(new IllegalStateException("Android context is required for audio capture."));
        }

        int minBufferSize = AudioRecord.getMinBufferSize(
            config.sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        );

        if (minBufferSize <= 0) {
            throw WakeWordError.inferenceError(new IllegalStateException("Invalid AudioRecord buffer size: " + minBufferSize));
        }

        int frameSize = Math.max(minBufferSize / 2, 512);
        int audioBufferSize = Math.max(minBufferSize * 2, config.sampleRate);

        ringBuffer = new float[Math.max(config.sampleRate * MIN_RING_BUFFER_SECONDS, inputShape.windowSamples)];
        ringWriteIndex = 0;
        ringSamplesAvailable = 0;
        audioRecord = new AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            config.sampleRate,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            audioBufferSize
        );

        if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
            throw WakeWordError.inferenceError(new IllegalStateException("AudioRecord is not initialized."));
        }

        audioRecord.startRecording();

        synchronized (lock) {
            isRunning = true;
        }

        short[] frame = new short[frameSize];
        audioThread = new Thread(() -> captureLoop(frame), "chaotika-wake-word-onnx");
        audioThread.start();
    }

    private void captureLoop(short[] frame) {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);
        int samplesSinceInference = 0;
        int strideSamples = Math.max(1, (config.sampleRate * manifest.runtimeConfig.frameMs) / 1_000);

        while (isRunning) {
            int read = audioRecord == null ? 0 : audioRecord.read(frame, 0, frame.length);

            if (read <= 0) {
                continue;
            }

            appendToRingBuffer(frame, read);
            samplesSinceInference += read;

            if (samplesSinceInference < strideSamples) {
                continue;
            }

            samplesSinceInference = 0;

            try {
                runInferenceIfReady();
            } catch (WakeWordError error) {
                fail(error);
            } catch (Exception error) {
                fail(WakeWordError.inferenceError(error));
            }
        }
    }

    private void appendToRingBuffer(short[] frame, int length) {
        for (int index = 0; index < length; index += 1) {
            ringBuffer[ringWriteIndex] = frame[index] / 32768f;
            ringWriteIndex = (ringWriteIndex + 1) % ringBuffer.length;
            ringSamplesAvailable = Math.min(ringSamplesAvailable + 1, ringBuffer.length);
        }
    }

    private void runInferenceIfReady() throws WakeWordError, OrtException {
        if (ringSamplesAvailable < inputShape.windowSamples) {
            return;
        }

        float[] rawInput = latestSamples(inputShape.windowSamples);

        if (config.vadEnabled && !CustomTfliteWakeWordEngine.shouldRunModelForAudio(rawInput)) {
            smoothedScore = 0f;
            updateScore(0f);
            return;
        }

        float score = smoothScore(runModel(CustomTfliteWakeWordEngine.normalizeForModel(rawInput)));
        updateScore(score);
        metricsLogger.scoreBucket(WakeWordProvider.CUSTOM_ONNX, score);

        if (score < threshold) {
            return;
        }

        long detectedAtEpochMillis = System.currentTimeMillis();
        short[] reviewSamples = buildReviewSamples(rawInput);
        WakeWordDetection detection = new WakeWordDetection(
            config.phraseId,
            config.displayPhrase,
            score,
            detectedAtEpochMillis,
            reviewSamples,
            config.sampleRate,
            WakeWordTrainingExampleStore.estimateNoiseLevelRms(reviewSamples, config.sampleRate)
        );
        WakeWordDiagnostics.recordDetection(detection);
        metricsLogger.wakeDetected(detection);

        WakeWordListener currentListener = listener;

        synchronized (lock) {
            isRunning = false;
        }

        if (currentListener != null) {
            currentListener.onWakeWordDetected(detection);
        }
    }

    private float[] latestSamples(int sampleCount) {
        float[] input = new float[sampleCount];
        int start = (ringWriteIndex - sampleCount + ringBuffer.length) % ringBuffer.length;

        for (int index = 0; index < sampleCount; index += 1) {
            input[index] = ringBuffer[(start + index) % ringBuffer.length];
        }

        return input;
    }

    private float runModel(float[] input) throws WakeWordError, OrtException {
        Object shapedInput = inputShape.toOnnxInput(input, inputRank);
        Map<String, OnnxTensor> inputs = new HashMap<>();

        try (OnnxTensor tensor = OnnxTensor.createTensor(ortEnvironment, shapedInput)) {
            inputs.put(inputName, tensor);
            try (OrtSession.Result result = ortSession.run(inputs)) {
                return readFirstOutputScore(result.get(0));
            }
        }
    }

    private float readFirstOutputScore(OnnxValue output) throws WakeWordError, OrtException {
        Object value = output.getValue();

        if (value instanceof float[] scores && scores.length > 0) {
            return scores[0];
        }

        if (value instanceof float[][] scores && scores.length > 0 && scores[0].length > 0) {
            return scores[0][0];
        }

        if (value instanceof float[][][] scores && scores.length > 0 && scores[0].length > 0 && scores[0][0].length > 0) {
            return scores[0][0][0];
        }

        throw WakeWordError.inferenceError(new IllegalStateException("ONNX wake-word model returned an empty output."));
    }

    private float smoothScore(float score) {
        if (manifest == null || !manifest.runtimeConfig.scoreSmoothing) {
            return score;
        }

        smoothedScore = smoothedScore <= 0f ? score : smoothedScore * 0.65f + score * 0.35f;

        return smoothedScore;
    }

    private short[] buildReviewSamples(float[] rawInput) {
        short[] postDetectionSamples = shouldCaptureTrainingPostRoll()
            ? capturePostDetectionSamples(postRollSampleCount())
            : new short[0];

        return CustomTfliteWakeWordEngine.prepareReviewSamples(
            rawInput,
            postDetectionSamples,
            config.sampleRate * MIN_RING_BUFFER_SECONDS
        );
    }

    private boolean shouldCaptureTrainingPostRoll() {
        return context != null && WakeWordTrainingExampleStore.isCollectionEnabled(context);
    }

    private int postRollSampleCount() {
        return (config.sampleRate * TRAINING_SAMPLE_POST_ROLL_MS) / 1_000;
    }

    private short[] capturePostDetectionSamples(int sampleCount) {
        if (sampleCount <= 0 || audioRecord == null) {
            return new short[0];
        }

        short[] samples = new short[sampleCount];
        short[] frame = new short[Math.min(1_024, sampleCount)];
        int offset = 0;

        while (offset < sampleCount && isRunning) {
            int read = audioRecord.read(frame, 0, Math.min(frame.length, sampleCount - offset));

            if (read <= 0) {
                break;
            }

            System.arraycopy(frame, 0, samples, offset, read);
            offset += read;
        }

        if (offset == sampleCount) {
            return samples;
        }

        return Arrays.copyOf(samples, offset);
    }

    private void updateScore(float score) {
        WakeWordDiagnostics.updateCurrentScore(score);

        WakeWordListener currentListener = listener;
        if (currentListener != null) {
            currentListener.onScore(score);
        }
    }

    private void fail(WakeWordError error) {
        synchronized (lock) {
            isRunning = false;
        }

        clearRingBuffer();
        WakeWordDiagnostics.recordError(error);
        metricsLogger.error(error);

        WakeWordListener currentListener = listener;
        if (currentListener != null) {
            currentListener.onError(error);
        }

        stop();
    }

    private void clearRingBuffer() {
        if (ringBuffer != null) {
            Arrays.fill(ringBuffer, 0f);
        }

        ringWriteIndex = 0;
        ringSamplesAvailable = 0;
        smoothedScore = 0f;
    }

    private static final class InterpreterShape {

        private final int windowSamples;

        private InterpreterShape(int windowSamples) {
            this.windowSamples = windowSamples;
        }

        static InterpreterShape from(
            long[] shape,
            WakeWordModelManifest.RuntimeConfig runtimeConfig,
            int sampleRate
        ) throws WakeWordError {
            int fallbackSamples = Math.max(
                DEFAULT_INFERENCE_STRIDE_SAMPLES,
                (sampleRate * runtimeConfig.windowMs) / 1_000
            );

            if (shape.length == 1) {
                return new InterpreterShape(readPositiveDimension(shape[0], fallbackSamples));
            }

            if (shape.length == 2 && isSingleOrDynamic(shape[0])) {
                return new InterpreterShape(readPositiveDimension(shape[1], fallbackSamples));
            }

            if (shape.length == 3 && isSingleOrDynamic(shape[0]) && isSingleOrDynamic(shape[2])) {
                return new InterpreterShape(readPositiveDimension(shape[1], fallbackSamples));
            }

            throw WakeWordError.modelLoadError(
                WakeWordProvider.CUSTOM_ONNX.metricValue,
                new IllegalStateException("Unsupported ONNX wake-word input shape: " + Arrays.toString(shape))
            );
        }

        Object toOnnxInput(float[] input, int inputRank) throws WakeWordError {
            if (inputRank == 1) {
                return input;
            }

            if (inputRank == 2) {
                return new float[][] { input };
            }

            if (inputRank == 3) {
                float[][][] shapedInput = new float[1][input.length][1];

                for (int index = 0; index < input.length; index += 1) {
                    shapedInput[0][index][0] = input[index];
                }

                return shapedInput;
            }

            throw WakeWordError.inferenceError(new IllegalStateException("Unsupported ONNX wake-word input rank: " + inputRank));
        }

        private static int readPositiveDimension(long dimension, int fallbackSamples) {
            return dimension > 0L ? Math.toIntExact(dimension) : fallbackSamples;
        }

        private static boolean isSingleOrDynamic(long dimension) {
            return dimension == 1L || dimension <= 0L;
        }
    }
}
