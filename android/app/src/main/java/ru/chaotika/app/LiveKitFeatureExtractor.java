package ru.chaotika.app;

import ai.onnxruntime.OrtException;

final class LiveKitFeatureExtractor implements AutoCloseable {

    static final int EMBEDDING_STRIDE_FRAMES = 8;
    static final int EMBEDDING_WINDOW_FRAMES = 76;

    private final EmbeddingModelOnnxRunner embeddingRunner;
    private final MelSpectrogramOnnxRunner melRunner;

    LiveKitFeatureExtractor(MelSpectrogramOnnxRunner melRunner, EmbeddingModelOnnxRunner embeddingRunner) {
        this.melRunner = melRunner;
        this.embeddingRunner = embeddingRunner;
    }

    float[][] extractEmbeddings(float[] audioWindow) throws WakeWordError {
        float[][] melFeatures = melRunner.run(audioWindow);
        if (melFeatures.length < EMBEDDING_WINDOW_FRAMES) {
            return new float[0][EmbeddingModelOnnxRunner.EMBEDDING_SIZE];
        }

        int windowCount = Math.max(0, (melFeatures.length - EMBEDDING_WINDOW_FRAMES) / EMBEDDING_STRIDE_FRAMES + 1);

        if (windowCount == 0) {
            return new float[0][EmbeddingModelOnnxRunner.EMBEDDING_SIZE];
        }

        float[][][] windows = new float[windowCount][EMBEDDING_WINDOW_FRAMES][MelSpectrogramOnnxRunner.MEL_BINS];
        for (int windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
            int startFrame = windowIndex * EMBEDDING_STRIDE_FRAMES;
            for (int frameIndex = 0; frameIndex < EMBEDDING_WINDOW_FRAMES; frameIndex += 1) {
                System.arraycopy(
                    melFeatures[startFrame + frameIndex],
                    0,
                    windows[windowIndex][frameIndex],
                    0,
                    MelSpectrogramOnnxRunner.MEL_BINS
                );
            }
        }

        return embeddingRunner.runWindows(windows);
    }

    @Override
    public void close() throws OrtException {
        try {
            melRunner.close();
        } finally {
            embeddingRunner.close();
        }
    }
}
