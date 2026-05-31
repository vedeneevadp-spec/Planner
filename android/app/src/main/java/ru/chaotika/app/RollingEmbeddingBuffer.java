package ru.chaotika.app;

final class RollingEmbeddingBuffer {

    private final float[][] embeddings;
    private final int embeddingSize;
    private int count;
    private int writeIndex;

    RollingEmbeddingBuffer(int embeddingWindowSize, int embeddingSize) {
        this.embeddings = new float[embeddingWindowSize][embeddingSize];
        this.embeddingSize = embeddingSize;
    }

    void append(float[] embedding) throws WakeWordError {
        if (embedding.length != embeddingSize) {
            throw WakeWordError.modelIoMismatch("LiveKit embedding vector size mismatch.");
        }

        System.arraycopy(embedding, 0, embeddings[writeIndex], 0, embeddingSize);
        writeIndex = (writeIndex + 1) % embeddings.length;
        count = Math.min(count + 1, embeddings.length);
    }

    void replaceWithLatest(float[][] latestEmbeddings) throws WakeWordError {
        clear();
        int start = Math.max(0, latestEmbeddings.length - embeddings.length);
        for (int index = start; index < latestEmbeddings.length; index += 1) {
            append(latestEmbeddings[index]);
        }
    }

    boolean isReady() {
        return count == embeddings.length;
    }

    float[][] classifierInput() throws WakeWordError {
        if (!isReady()) {
            throw WakeWordError.frontendNotReady("LiveKit embedding buffer is not full.");
        }

        float[][] result = new float[embeddings.length][embeddingSize];
        int start = writeIndex % embeddings.length;
        for (int index = 0; index < embeddings.length; index += 1) {
            System.arraycopy(embeddings[(start + index) % embeddings.length], 0, result[index], 0, embeddingSize);
        }

        return result;
    }

    void clear() {
        for (float[] embedding : embeddings) {
            java.util.Arrays.fill(embedding, 0f);
        }
        count = 0;
        writeIndex = 0;
    }
}
