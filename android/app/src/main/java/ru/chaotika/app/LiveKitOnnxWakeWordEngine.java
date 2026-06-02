package ru.chaotika.app;

import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtException;
import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import java.util.Arrays;

final class LiveKitOnnxWakeWordEngine implements WakeWordEngine {

    private static final int MIN_WINDOW_SECONDS = 2;
    private static final int TRAINING_SAMPLE_POST_ROLL_MS = 800;

    private final WakeWordAssetSource assets;
    private final WakeWordConfig config;
    private final Context context;
    private final Object lock = new Object();
    private final WakeWordMetricsLogger metricsLogger;

    private AudioRecord audioRecord;
    private Thread audioThread;
    private WakeWordClassifierOnnxRunner classifierRunner;
    private LiveKitFeatureExtractor featureExtractor;
    private RollingEmbeddingBuffer embeddingBuffer;
    private volatile boolean isRunning;
    private WakeWordListener listener;
    private WakeWordModelManifest manifest;
    private OrtEnvironment ortEnvironment;
    private float[] ringBuffer;
    private int ringSamplesAvailable;
    private int ringWriteIndex;
    private float smoothedScore;
    private volatile float threshold;

    LiveKitOnnxWakeWordEngine(
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
            ensureManifestSupported(manifest);
            threshold = manifest.threshold;
            smoothedScore = 0f;
            WakeWordDiagnostics.updateModel(manifest.modelVersion, manifest.provider, threshold);
            ensureAssetsExist(manifest);
            ensureMicrophonePermission();
            createRunners(manifest);
            metricsLogger.liveKitFrontendLoaded(manifest);
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

        closeRunners();
        clearBuffers();

        if (threadToJoin != null && threadToJoin != Thread.currentThread()) {
            try {
                threadToJoin.join(700L);
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private static void ensureManifestSupported(WakeWordModelManifest manifest) throws WakeWordError {
        if (manifest.provider != WakeWordProvider.CUSTOM_ONNX) {
            throw WakeWordError.unsupportedProvider(manifest.provider.manifestValue);
        }

        if (manifest.inputKind != WakeWordModelInputKind.EMBEDDING_MATRIX) {
            throw WakeWordError.unsupportedModelInput("LiveKit ONNX engine requires inputKind=embedding_matrix.");
        }

        if (manifest.frontend != WakeWordModelFrontend.LIVEKIT_OPENWAKEWORD) {
            throw WakeWordError.unsupportedModelInput("LiveKit ONNX engine requires frontend=livekit_openwakeword.");
        }

        if (manifest.frontendConfig.embeddingWindowSize != 16 || manifest.frontendConfig.embeddingSize != 96) {
            throw WakeWordError.modelIoMismatch("LiveKit frontendConfig must be embeddingWindowSize=16 and embeddingSize=96.");
        }
    }

    private void ensureAssetsExist(WakeWordModelManifest manifest) throws WakeWordError {
        if (!assets.exists(manifest.melSpectrogramModelPath)) {
            throw WakeWordError.missingFrontendModel(manifest.melSpectrogramModelPath);
        }

        if (!assets.exists(manifest.embeddingModelPath)) {
            throw WakeWordError.missingFrontendModel(manifest.embeddingModelPath);
        }

        if (!assets.exists(manifest.classifierModelPath)) {
            throw WakeWordError.missingModel(manifest.classifierModelPath);
        }
    }

    private void createRunners(WakeWordModelManifest manifest) throws WakeWordError {
        ortEnvironment = OrtEnvironment.getEnvironment();
        MelSpectrogramOnnxRunner melRunner = new MelSpectrogramOnnxRunner(
            ortEnvironment,
            readAsset(manifest.melSpectrogramModelPath, true)
        );
        EmbeddingModelOnnxRunner embeddingRunner = new EmbeddingModelOnnxRunner(
            ortEnvironment,
            readAsset(manifest.embeddingModelPath, true)
        );
        featureExtractor = new LiveKitFeatureExtractor(melRunner, embeddingRunner);
        classifierRunner = new WakeWordClassifierOnnxRunner(
            ortEnvironment,
            readAsset(manifest.classifierModelPath, false),
            manifest.frontendConfig.embeddingWindowSize,
            manifest.frontendConfig.embeddingSize
        );
        embeddingBuffer = new RollingEmbeddingBuffer(
            manifest.frontendConfig.embeddingWindowSize,
            manifest.frontendConfig.embeddingSize
        );
    }

    private byte[] readAsset(String path, boolean frontendModel) throws WakeWordError {
        try {
            return assets.read(path);
        } catch (Exception error) {
            if (frontendModel) {
                throw WakeWordError.missingFrontendModel(path);
            }
            throw WakeWordError.missingModel(path);
        }
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

        if (config.sampleRate != 16_000) {
            throw WakeWordError.unsupportedSampleRate(config.sampleRate);
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
        int windowSamples = config.sampleRate * MIN_WINDOW_SECONDS;

        ringBuffer = new float[windowSamples];
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
        audioThread = new Thread(() -> captureLoop(frame), "chaotika-wake-word-livekit-onnx");
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

    private void runInferenceIfReady() throws WakeWordError {
        if (ringSamplesAvailable < ringBuffer.length) {
            return;
        }

        float[] rawInput = latestSamples(ringBuffer.length);

        if (config.vadEnabled && !CustomTfliteWakeWordEngine.shouldRunModelForAudio(rawInput)) {
            smoothedScore = 0f;
            updateScore(0f);
            return;
        }

        if (featureExtractor == null || classifierRunner == null || embeddingBuffer == null) {
            throw WakeWordError.frontendNotReady("LiveKit ONNX frontend is not initialized.");
        }

        float[][] embeddings = featureExtractor.extractEmbeddings(rawInput);
        if (embeddings.length < manifest.frontendConfig.embeddingWindowSize) {
            smoothedScore = 0f;
            updateScore(0f);
            return;
        }

        embeddingBuffer.replaceWithLatest(embeddings);
        metricsLogger.liveKitEmbeddingGenerated(manifest);
        float score = smoothScore(classifierRunner.score(embeddingBuffer.classifierInput()));
        updateScore(score);
        metricsLogger.liveKitClassifierScoreBucket(manifest, score);

        if (score < threshold) {
            return;
        }

        emitDetection(score, rawInput);
    }

    private float[] latestSamples(int sampleCount) {
        float[] input = new float[sampleCount];
        int start = (ringWriteIndex - sampleCount + ringBuffer.length) % ringBuffer.length;

        for (int index = 0; index < sampleCount; index += 1) {
            input[index] = ringBuffer[(start + index) % ringBuffer.length];
        }

        return input;
    }

    private float smoothScore(float score) {
        if (manifest == null || !manifest.runtimeConfig.scoreSmoothing) {
            return score;
        }

        smoothedScore = smoothedScore <= 0f ? score : smoothedScore * 0.65f + score * 0.35f;

        return smoothedScore;
    }

    private void emitDetection(float score, float[] rawInput) {
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

    private short[] buildReviewSamples(float[] rawInput) {
        short[] postDetectionSamples = shouldCaptureTrainingPostRoll()
            ? capturePostDetectionSamples(postRollSampleCount())
            : new short[0];

        return CustomTfliteWakeWordEngine.prepareReviewSamples(
            rawInput,
            postDetectionSamples,
            config.sampleRate * MIN_WINDOW_SECONDS
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

        clearBuffers();
        WakeWordDiagnostics.recordError(error);
        metricsLogger.error(error);

        WakeWordListener currentListener = listener;
        if (currentListener != null) {
            currentListener.onError(error);
        }

        stop();
    }

    private void closeRunners() {
        if (featureExtractor != null) {
            try {
                featureExtractor.close();
            } catch (OrtException ignored) {
                // The frontend is being torn down after stop/error.
            }
            featureExtractor = null;
        }

        if (classifierRunner != null) {
            try {
                classifierRunner.close();
            } catch (OrtException ignored) {
                // The classifier is being torn down after stop/error.
            }
            classifierRunner = null;
        }
    }

    private void clearBuffers() {
        if (ringBuffer != null) {
            Arrays.fill(ringBuffer, 0f);
        }

        if (embeddingBuffer != null) {
            embeddingBuffer.clear();
        }

        ringWriteIndex = 0;
        ringSamplesAvailable = 0;
        smoothedScore = 0f;
    }
}
