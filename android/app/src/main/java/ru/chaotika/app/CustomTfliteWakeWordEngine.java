package ru.chaotika.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;
import org.tensorflow.lite.Interpreter;

final class CustomTfliteWakeWordEngine implements WakeWordEngine {

    private static final int INFERENCE_STRIDE_SAMPLES = 1_600;
    private static final int MIN_RING_BUFFER_SECONDS = 2;
    private static final int TRAINING_SAMPLE_POST_ROLL_MS = 800;
    private static final int VAD_FRAME_SAMPLES = 320;
    private static final int VAD_MIN_ACTIVE_FRAMES = 10;
    private static final int VAD_MIN_CONSECUTIVE_SPEECH_FRAMES = 5;
    private static final float VAD_FRAME_MIN_PEAK = 0.018f;
    private static final float VAD_FRAME_MIN_RMS = 0.008f;
    private static final float VAD_MAX_SPEECH_ZERO_CROSSING_RATE = 0.35f;
    private static final float VAD_MIN_RMS = 0.006f;
    private static final float NORMALIZE_MIN_PEAK = 0.01f;
    private static final float NORMALIZE_TARGET_PEAK = 0.85f;
    private static final float NORMALIZE_MAX_GAIN = 8f;

    private final Context context;
    private final WakeWordConfig config;
    private final WakeWordAssetSource assets;
    private final WakeWordMetricsLogger metricsLogger;
    private final Object lock = new Object();

    private volatile boolean isRunning;
    private WakeWordListener listener;
    private Interpreter interpreter;
    private AudioRecord audioRecord;
    private Thread audioThread;
    private float[] ringBuffer;
    private int ringWriteIndex;
    private int ringSamplesAvailable;
    private volatile float threshold;

    CustomTfliteWakeWordEngine(Context context, WakeWordConfig config, WakeWordAssetSource assets, WakeWordMetricsLogger metricsLogger) {
        this.context = context == null ? null : context.getApplicationContext();
        this.config = config;
        this.assets = assets;
        this.metricsLogger = metricsLogger;
        this.threshold = config.threshold;
    }

    CustomTfliteWakeWordEngine(WakeWordConfig config, WakeWordAssetSource assets, WakeWordMetricsLogger metricsLogger) {
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
    public void start(WakeWordListener listener) {
        synchronized (lock) {
            if (isRunning) {
                return;
            }

            this.listener = listener;
        }

        try {
            WakeWordModelManifest manifest = WakeWordModelManifest.read(assets, config);
            if (manifest.provider != WakeWordProvider.CUSTOM_TFLITE) {
                throw WakeWordError.unsupportedProvider(manifest.provider.manifestValue);
            }
            threshold = manifest.threshold;
            WakeWordDiagnostics.updateModel(manifest.modelVersion, manifest.provider, threshold);

            if (!assets.exists(manifest.modelPath)) {
                throw WakeWordError.missingModel(manifest.modelPath);
            }

            ensureMicrophonePermission();
            interpreter = createInterpreter(assets.read(manifest.modelPath));
            metricsLogger.modelLoaded(manifest);
            startAudioCapture();
        } catch (WakeWordError error) {
            fail(error);
        } catch (Exception error) {
            fail(WakeWordError.tfliteRuntimeInitError(error));
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

        if (interpreter != null) {
            interpreter.close();
            interpreter = null;
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

    int bufferedSampleCountForTesting() {
        return ringSamplesAvailable;
    }

    int ringBufferCapacityForTesting() {
        return ringBuffer == null ? 0 : ringBuffer.length;
    }

    private Interpreter createInterpreter(byte[] modelBytes) {
        ByteBuffer buffer = ByteBuffer.allocateDirect(modelBytes.length).order(ByteOrder.nativeOrder());
        buffer.put(modelBytes);
        buffer.rewind();

        Interpreter.Options options = new Interpreter.Options();
        options.setNumThreads(2);

        return new Interpreter(buffer, options);
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

        ringBuffer = new float[Math.max(config.sampleRate * MIN_RING_BUFFER_SECONDS, expectedInputSamples())];
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
        audioThread = new Thread(() -> captureLoop(frame), "chaotika-wake-word");
        audioThread.start();
    }

    private void captureLoop(short[] frame) {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_AUDIO);
        int samplesSinceInference = 0;

        while (isRunning) {
            int read = audioRecord == null ? 0 : audioRecord.read(frame, 0, frame.length);

            if (read <= 0) {
                continue;
            }

            appendToRingBuffer(frame, read);
            samplesSinceInference += read;

            if (samplesSinceInference < INFERENCE_STRIDE_SAMPLES) {
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
        int expectedInputSamples = expectedInputSamples();

        if (ringSamplesAvailable < expectedInputSamples) {
            return;
        }

        float[] rawInput = latestSamples(expectedInputSamples);

        if (config.vadEnabled && !shouldRunModelForAudio(rawInput)) {
            updateScore(0f);
            return;
        }

        float score = runModel(normalizeForModel(rawInput));
        updateScore(score);
        metricsLogger.scoreBucket(WakeWordProvider.CUSTOM_TFLITE, score);

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

    private int expectedInputSamples() throws WakeWordError {
        int[] shape = interpreter.getInputTensor(0).shape();

        if (shape.length == 2 && shape[0] == 1) {
            return shape[1];
        }

        if (shape.length == 3 && shape[0] == 1 && shape[2] == 1) {
            return shape[1];
        }

        throw WakeWordError.tfliteRuntimeInitError(
            new IllegalStateException("Unsupported wake-word model input shape: " + Arrays.toString(shape))
        );
    }

    private float[] latestSamples(int sampleCount) {
        float[] input = new float[sampleCount];
        int start = (ringWriteIndex - sampleCount + ringBuffer.length) % ringBuffer.length;

        for (int index = 0; index < sampleCount; index += 1) {
            input[index] = ringBuffer[(start + index) % ringBuffer.length];
        }

        return input;
    }

    static float[] normalizeForModel(float[] input) {
        float[] output = Arrays.copyOf(input, input.length);
        float peak = peakAbs(output);

        if (peak < NORMALIZE_MIN_PEAK) {
            return output;
        }

        float gain = Math.min(NORMALIZE_TARGET_PEAK / peak, NORMALIZE_MAX_GAIN);

        for (int index = 0; index < output.length; index += 1) {
            output[index] = Math.max(-1f, Math.min(1f, output[index] * gain));
        }

        return output;
    }

    static boolean shouldRunModelForAudio(float[] input) {
        if (input.length < VAD_FRAME_SAMPLES || rootMeanSquare(input) < VAD_MIN_RMS) {
            return false;
        }

        int activeFrames = 0;
        int consecutiveSpeechFrames = 0;
        int maxConsecutiveSpeechFrames = 0;

        for (int offset = 0; offset + VAD_FRAME_SAMPLES <= input.length; offset += VAD_FRAME_SAMPLES) {
            FrameActivity activity = frameActivity(input, offset, VAD_FRAME_SAMPLES);

            if (!activity.isActive()) {
                consecutiveSpeechFrames = 0;
                continue;
            }

            activeFrames += 1;

            if (activity.isSpeechLike()) {
                consecutiveSpeechFrames += 1;
                maxConsecutiveSpeechFrames = Math.max(maxConsecutiveSpeechFrames, consecutiveSpeechFrames);
            } else {
                consecutiveSpeechFrames = 0;
            }
        }

        return activeFrames >= VAD_MIN_ACTIVE_FRAMES &&
            maxConsecutiveSpeechFrames >= VAD_MIN_CONSECUTIVE_SPEECH_FRAMES;
    }

    private short[] buildReviewSamples(float[] rawInput) {
        short[] postDetectionSamples = shouldCaptureTrainingPostRoll()
            ? capturePostDetectionSamples(postRollSampleCount())
            : new short[0];

        return prepareReviewSamples(rawInput, postDetectionSamples, expectedTrainingWindowSamples());
    }

    static short[] prepareReviewSamples(float[] rawInput, short[] postDetectionSamples, int fallbackWindowSamples) {
        short[] preDetectionSamples = WakeWordTrainingExampleStore.toPcm16(rawInput);
        short[] combinedSamples = appendSamples(preDetectionSamples, postDetectionSamples);

        try {
            return WakeWordSampleProcessor.process(combinedSamples, combinedSamples.length).samples;
        } catch (WakeWordSampleProcessor.ValidationException ignored) {
            return latestPcmWindow(combinedSamples, fallbackWindowSamples);
        }
    }

    private boolean shouldCaptureTrainingPostRoll() {
        return context != null && WakeWordTrainingExampleStore.isCollectionEnabled(context);
    }

    private int postRollSampleCount() {
        return (config.sampleRate * TRAINING_SAMPLE_POST_ROLL_MS) / 1_000;
    }

    private int expectedTrainingWindowSamples() {
        return config.sampleRate * MIN_RING_BUFFER_SECONDS;
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

    static short[] appendSamples(short[] first, short[] second) {
        short[] combined = new short[first.length + second.length];
        System.arraycopy(first, 0, combined, 0, first.length);
        System.arraycopy(second, 0, combined, first.length, second.length);
        return combined;
    }

    static short[] latestPcmWindow(short[] samples, int maxSamples) {
        if (samples.length <= maxSamples) {
            return samples.clone();
        }

        return Arrays.copyOfRange(samples, samples.length - maxSamples, samples.length);
    }

    private static float peakAbs(float[] input) {
        float peak = 0f;

        for (float sample : input) {
            peak = Math.max(peak, Math.abs(sample));
        }

        return peak;
    }

    private static FrameActivity frameActivity(float[] input, int offset, int length) {
        float peak = 0f;
        float sum = 0f;
        int crossings = 0;
        float previous = input[offset];

        for (int index = 0; index < length; index += 1) {
            float sample = input[offset + index];
            peak = Math.max(peak, Math.abs(sample));
            sum += sample * sample;

            if (index > 0 && sample != 0f && previous != 0f && Math.signum(sample) != Math.signum(previous)) {
                crossings += 1;
            }

            previous = sample;
        }

        return new FrameActivity(peak, (float) Math.sqrt(sum / length), crossings / (float) (length - 1));
    }

    private float runModel(float[] input) throws WakeWordError {
        int[] inputShape = interpreter.getInputTensor(0).shape();
        int[] outputShape = interpreter.getOutputTensor(0).shape();
        Object output = createOutputBuffer(outputShape);

        if (inputShape.length == 2) {
            interpreter.run(new float[][] { input }, output);
        } else if (inputShape.length == 3) {
            float[][][] shapedInput = new float[1][input.length][1];

            for (int index = 0; index < input.length; index += 1) {
                shapedInput[0][index][0] = input[index];
            }

            interpreter.run(shapedInput, output);
        } else {
            throw WakeWordError.tfliteRuntimeInitError(
                new IllegalStateException("Unsupported wake-word model input shape: " + Arrays.toString(inputShape))
            );
        }

        return readFirstOutputScore(output);
    }

    private Object createOutputBuffer(int[] outputShape) throws WakeWordError {
        if (outputShape.length == 1) {
            return new float[outputShape[0]];
        }

        if (outputShape.length == 2) {
            return new float[outputShape[0]][outputShape[1]];
        }

        if (outputShape.length == 3) {
            return new float[outputShape[0]][outputShape[1]][outputShape[2]];
        }

        throw WakeWordError.tfliteRuntimeInitError(
            new IllegalStateException("Unsupported wake-word model output shape: " + Arrays.toString(outputShape))
        );
    }

    private float readFirstOutputScore(Object output) throws WakeWordError {
        if (output instanceof float[] value && value.length > 0) {
            return value[0];
        }

        if (output instanceof float[][] value && value.length > 0 && value[0].length > 0) {
            return value[0][0];
        }

        if (
            output instanceof float[][][] value &&
            value.length > 0 &&
            value[0].length > 0 &&
            value[0][0].length > 0
        ) {
            return value[0][0][0];
        }

        throw WakeWordError.inferenceError(new IllegalStateException("Wake-word model returned an empty output."));
    }

    private static float rootMeanSquare(float[] input) {
        float sum = 0f;

        for (float sample : input) {
            sum += sample * sample;
        }

        return (float) Math.sqrt(sum / input.length);
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
    }

    private static final class FrameActivity {

        private final float peak;
        private final float rms;
        private final float zeroCrossingRate;

        private FrameActivity(float peak, float rms, float zeroCrossingRate) {
            this.peak = peak;
            this.rms = rms;
            this.zeroCrossingRate = zeroCrossingRate;
        }

        private boolean isActive() {
            return peak >= VAD_FRAME_MIN_PEAK && rms >= VAD_FRAME_MIN_RMS;
        }

        private boolean isSpeechLike() {
            return isActive() && zeroCrossingRate <= VAD_MAX_SPEECH_ZERO_CROSSING_RATE;
        }
    }
}
